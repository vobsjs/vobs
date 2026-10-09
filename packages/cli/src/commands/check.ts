/**
 * `vobs check` —— 不跑应用就能给出的源码问题清单。
 *
 * 为什么需要它：vobs 里最容易犯的错是**不发声**的错（effect 自订阅、列表写进三元分支
 * 后失去 keyed 复用）。运行时护栏（`@vobs/vobs/dev`）能抓到，但那要求先把应用跑起来；
 * 静态检查让你（和 AI）在**写完之后、运行之前**就知道哪里不对。
 *
 * 产出与框架其余部分同一套词汇（code / severity / fix），字段直接对应
 * `@vobs/runtime/error` 的 `VobsError`，因此能直接喂给开发台面板或 AI。
 *
 * 规则的高精度是刻意的：宁可少报，也不要误报 —— 误报会让 AI 去改本来正确的代码。
 *
 * ## 已知限制
 *
 * 三条规则都是**启发式**的（靠名字与形状判断），所以会撞到合法代码：
 *
 * - `VOBS_C210`：把「同一个 `X.value` 的读写」当作信号自订阅。**分不清信号与恰好叫 `value`
 *   的普通字段** —— `entry.value = x`（DTO / ref / 配置对象）会被误报。收窄成「只认裸标识符」
 *   会连 `props.name.value` 这种真信号一起放过，所以保持现状 + 提供行内抑制。
 * - `VOBS_C232` / `VOBS_C118`：前者看的是「列表表达式是否写在分支里」，后者看「组件体里
 *   是否把信号读取存进了局部变量」。都只看形状，不做类型推断。
 *
 * 撞上误报时的正规做法是**行内抑制**（`// vobs-check-ignore-next-line`），
 * 而不是关掉整条规则或改写本来正确的代码。
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { compileWithSourceMap } from '@vobs/compiler'
import { analyzeSource, type CheckDiagnostic } from '@vobs/compiler'
import path from 'node:path'
import { logger } from '../utils/logger.js'

export interface CheckOptions {
  readonly dir?: string
  readonly json?: boolean
  /** 把结果写到 `<root>/.vobs/check.json`（开发台面板读这个文件显示「项目」页）。 */
  readonly write?: boolean
  /** 把测试文件也纳入检查（默认跳过：fixture 里常有意为之的写法会淹没真问题）。 */
  readonly includeTests?: boolean
  /**
   * 同时跑**编译器**诊断（默认 true）。
   *
   * 为什么必须合并：此前 `vobs check` **完全不跑编译器** —— 它只有自己那套
   * `analyzeSource`（C118/C210/C232）。于是编译器的五条诊断
   * （C104/C105/C106/C107/C108）**在批量入口隐形**，只有 `vite build` 看得到。
   * 实测：一个模块顶层 JSX 的文件，`vobs check` 报「检查通过」。
   *
   * 这是同一类通道问题的第三次：① vite build 报第一个文件就停 ② describeDiagnostics
   * 只过滤 error（warning 静默）③ 本处。**通道不通，等于诊断不存在。**
   *
   * 代价是每个文件多跑一次编译 —— 需要更快可用 `--no-compiler`。
   */
  readonly compiler?: boolean
}

/** 检查报告的固定落点，相对被检查的根目录。 */
export const REPORT_PATH = '.vobs/check.json'

/** 测试文件默认跳过。 */
const TEST_FILE = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.tsx?|__tests__\/)/u


const SKIP_DIRS = new Set(['node_modules', 'dist', 'lib', 'build', '.git', '.vobs', 'coverage'])

/**
 * 收集目标下的 .ts/.tsx。
 *
 * **根目录**读不到时**必须抛错**，不能返回空数组：此前那个 `catch { return }` 把
 * 不存在的目录、以及"误传一个文件进来"都变成 `0 个文件` + exit 0 ——
 * `vobs check <不存在的目录>` 会打印 `✔ 检查通过 —— 0 个文件，没有发现问题`。
 * CI 里把路径写错就是**永久绿灯**，比报错更危险（一个检查工具在最该失败的场景下静默通过）。
 *
 * 子目录读不到仍然跳过（权限不足/竞态删除不该让整次检查失败）——那是有意的容错，
 * 与"根目录不存在"不是一回事。
 */
async function collectSources(root: string): Promise<string[]> {
  let rootStat
  try {
    rootStat = await stat(root)
  } catch {
    throw new Error(`路径不存在：${root}`)
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`不是目录：${root}（vobs check 接受一个目录）`)
  }

  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // 根目录在第一次 stat 之后消失（竞态）也必须暴露，而不是混进"0 个文件"
      if (dir === root) {
        throw new Error(`无法读取目录：${root}（${error instanceof Error ? error.message : String(error)}）`)
      }
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!/\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) continue
      found.push(path.join(dir, entry.name))
    }
  }
  await walk(root)
  return found.sort()
}

/* ------------------------------------------------------------------ 工具 */

/** 该节点是否返回 JSX（函数体里出现 JSX 元素/片段）。 */
function compileDiagnostics(text: string, file: string, existing: readonly CheckDiagnostic[]): CheckDiagnostic[] {
  let result: ReturnType<typeof compileWithSourceMap>
  try {
    result = compileWithSourceMap(text, { filename: file })
  } catch {
    return []
  }
  const lines = text.split(/\r?\n/u)
  const seen = new Set(existing.map(item => `${item.code}|${item.file}|${item.line}|${item.column}`))
  const out: CheckDiagnostic[] = []
  for (const item of result.diagnostics) {
    const { line, column } = item.location
    const key = `${item.code}|${file}|${line}|${column}`
    // 与 analyzeSource 的结果去重（两套规则偶有重叠码）
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      code: item.code,
      severity: item.severity,
      message: item.message,
      // fix 是必填字段：编译器没给时也要有可执行的方向，不能留空
      fix: item.fix ?? '见该诊断码的说明（`vobs explain` 或框架文档）。',
      file,
      line,
      column,
      snippet: (lines[line - 1] ?? '').trim()
    })
  }
  return out
}

export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const root = path.resolve(options.dir ?? process.cwd())
  let all: string[]
  try {
    all = await collectSources(root)
  } catch (error) {
    // 路径无效必须是**失败**，不能是"0 个文件，检查通过"（见 collectSources 注释）
    logger.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }
  const files = options.includeTests === true
    ? all
    : all.filter(file => !TEST_FILE.test(path.relative(root, file).split(path.sep).join('/')))
  const skipped = all.length - files.length

  const diagnostics: CheckDiagnostic[] = []
  for (const absolute of files) {
    const text = await readFile(absolute, 'utf8')
    const relative = path.relative(root, absolute).split(path.sep).join('/')
    diagnostics.push(...analyzeSource(text, relative))
    if (options.compiler !== false) diagnostics.push(...compileDiagnostics(text, relative, diagnostics))
  }

  const errors = diagnostics.filter(item => item.severity === 'error')
  const report = { root, files: files.length, skippedTests: skipped, diagnostics }

  if (options.write === true) {
    const target = path.join(root, REPORT_PATH)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    // --json 时 stdout 必须只剩 JSON，所以这行提示走 logger（stderr）
    logger.info(`报告写入 ${REPORT_PATH}（开发台面板读它显示「项目」页）`)
  }

  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2))
    if (errors.length > 0) process.exitCode = 1
    return
  }

  if (diagnostics.length === 0) {
    logger.success(`检查通过 —— ${files.length} 个文件${skipped > 0 ? `（跳过 ${skipped} 个测试文件）` : ''}，没有发现问题`)
    return
  }

  console.log('')
  for (const item of diagnostics) {
    const mark = item.severity === 'error' ? '✖' : '!'
    console.log(`  ${mark} ${item.file}:${item.line}:${item.column}  ${item.code}`)
    console.log(`    ${item.message}`)
    if (item.snippet !== '') console.log(`    ${item.snippet}`)
    console.log(`    → ${item.fix}`)
    console.log('')
  }
  const warnings = diagnostics.length - errors.length
  console.log(
    `  ${errors.length} 个错误 · ${warnings} 个警告 · 共检查 ${files.length} 个文件`
    + `${skipped > 0 ? `（跳过 ${skipped} 个测试文件，用 --include-tests 纳入）` : ''}\n`
  )

  if (errors.length > 0) process.exitCode = 1
}


// 搬迁到 @vobs/compiler 后继续从这里再导出，避免既有导入方失效
export { analyzeSource, VOBS_C118, VOBS_C210, VOBS_C232 } from '@vobs/compiler'
export type { CheckDiagnostic } from '@vobs/compiler'
