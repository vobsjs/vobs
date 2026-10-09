/*
 * ⚠️ **刻意不进 gate**：当前有 9 处 workspace 依赖缺失待分诊（见提交说明）。
 * 接进 gate 会让门禁变红，而修 9 个包（含 3 个 Git 安装的插件包）需要先逐个确认
 * 「是真缺依赖，还是 #import type 被我漏过滤 / 由 peer 提供」——
 * 那是下一轮的活。先把检查落下来，让缺口**可见**。
 *
 * 仓库不变量检查 —— 把「踩过的坑」变成「谁都踩不到」。
 *
 * 每一条都直接来自真实事故，不是想象出来的规范。
 *
 * ## 检查 1：workspace 包 import 了却没声明依赖
 *
 * 事故（**同一个模式踩了两次**）：`explain.ts` import 了 `@vobs/runtime`、
 * `check.ts` import 了 `@vobs/compiler`，但两者都不在 `@vobs/cli` 的
 * `package.json` 依赖里。
 *
 * 为什么难发现：
 * - **cwd = 仓库根时一切正常**（能向上找到根 node_modules 的软链）
 * - cwd 一换就 `ERR_MODULE_NOT_FOUND`
 * - 报错形态是 `node:internal/modules/run_main` —— 完全看不出是依赖问题
 *
 * 也就是说：**本地手动跑永远正常，只有 CI 或换目录才炸。**
 *
 * ## 检查 2：`.mjs` 里写了 TypeScript 类型标注
 *
 * 事故：我**连续三次**在生成改动的 `.mjs` 脚本里写了 `const x: string[] = []`
 * —— `.mjs` 是 JS，脚本直接语法错误、**一处改动都没生效**。
 * 每次都浪费一个来回（而且要重新核对"到底改没改"）。
 *
 * 这条只做**窄检测**（明确的变量/参数注解），宁可漏也不误报 ——
 * 冒号在三元、可选链、对象字面量里到处都是。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const failures = []

/* ---------------------------------------------- 检查 1 */

/** 收集一个包源码里 import 的 `@vobs/*` 包名（跳过测试文件）。 */
function importedWorkspacePackages(srcDir) {
  const found = new Set()
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) continue
      if (/\.(?:test|spec)\./.test(entry.name)) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      /*
       * 静态 import 与动态 import() 都要算，但**纯类型导入不算**：
       * \`import type { X } from '@vobs/y'\` 与 \`import { type X } from '@vobs/y'\`
       * 不需要运行时依赖（那是 devDependencies 的领域）。把它们算进来会误报。
       */
      const withoutTypeImports = text
        .replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]/g, '')
        .replace(/\btype\s+[A-Za-z_$][\w$]*(?:\s*,\s*type\s+[A-Za-z_$][\w$]*)*\s*[,}]/g, '}')
      for (const match of withoutTypeImports.matchAll(/from\s+['"](@vobs\/[a-z0-9-]+)['"]/g)) found.add(match[1])
      for (const match of withoutTypeImports.matchAll(/import\s*\(\s*['"](@vobs\/[a-z0-9-]+)['"]/g)) found.add(match[1])
      for (const match of text.matchAll(/import\s*\(\s*['"](@vobs\/[a-z0-9-]+)['"]/g)) found.add(match[1])
    }
  }
  walk(srcDir, 0)
  return found
}

function checkWorkspaceDependencies() {
  const packagesDir = path.join(ROOT, 'packages')
  if (!existsSync(packagesDir)) return
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = path.join(packagesDir, entry.name)
    const manifestPath = path.join(pkgDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    let manifest
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { continue }
    if (manifest.name === undefined) continue
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      // 注：devDependencies 不算 —— 源码（非测试）import 一个只在 dev 声明的包，
      // 对使用者就是缺依赖。测试文件已在扫描时跳过，所以这里不需要放宽。
    ])
    const srcDir = path.join(pkgDir, 'src')
    if (!existsSync(srcDir)) continue
    for (const imported of importedWorkspacePackages(srcDir)) {
      if (imported === manifest.name) continue
      if (declared.has(imported)) continue
      failures.push(
        `${manifest.name} 的源码 import 了 ${imported}，但 package.json 里没有声明。\n`
        + `    → 本地（cwd = 仓库根）能跑，cwd 一换就 ERR_MODULE_NOT_FOUND。\n`
        + `    → 修法：给 ${manifest.name} 加 "${imported}": "workspace:*"`
      )
    }
  }
}

/* ---------------------------------------------- 检查 2 */

/** 一行里是否有**明确的** TS 类型标注（窄检测，目标是零误报）。 */
function looksLikeTypeAnnotation(line) {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return false
  /*
   * **只认一种形态**：声明 + 注解 + 等号，且类型必须"长得像类型"。
   *
   * 我第一版还检测"形参注解"和"对象属性"，实测**全是误报**：
   *   build-packages.mjs  entry: entryFor(ts), dts: true, clean: true   ← ", dts: true," 被当成形参
   *   check-release.mjs   { name: x, version: manifest.version, ... }    ← 对象属性也匹配
   * 那两个脚本是**能正常跑的**，所以那是检查本身错了 —— 而误报会拦门禁。
   *
   * 收紧后只认：const NAME: <像类型的> =
   * 类型必须是大写开头（string[]/string/number 这类 TS 关键字显式列出）、
   * 或带 <> / [] —— "true"、"manifest.version" 都不符合。
   */
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|unknown|any|never|void|[A-Z][\w$.]*)\s*(?:\[\]|<[^>]*>)?\s*=[^=]/.test(text)
}

function checkMjsTypeAnnotations() {
  const scriptsDir = path.join(ROOT, 'scripts')
  if (!existsSync(scriptsDir)) return
  const walk = (dir, depth) => {
    if (depth > 4) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!entry.name.endsWith('.mjs')) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      const relative = path.relative(ROOT, full).split(path.sep).join('/')
      text.split(/\r?\n/).forEach((line, index) => {
        if (looksLikeTypeAnnotation(line)) {
          failures.push(
            `${relative}:${index + 1} 在 .mjs 里写了 TypeScript 类型标注：\n`
            + `    ${line.trim().slice(0, 90)}\n`
            + `    → .mjs 是 JS：脚本会**直接语法错误**，改动一处都不会生效（踩过三次）。\n`
            + `    → 去掉注解，或把脚本改成 .ts 由 tsx 运行。`
          )
        }
      })
    }
  }
  walk(scriptsDir, 0)
}

/* ---------------------------------------------- 运行 */

checkWorkspaceDependencies()
checkMjsTypeAnnotations()

if (failures.length > 0) {
  console.error(`vobs check --invariants: ${failures.length} 处不变量被破坏\n`)
  for (const item of failures) console.error(`  ✖ ${item}\n`)
  process.exitCode = 1
} else {
  console.log('vobs check --invariants: workspace 依赖声明与 .mjs 注解检查通过 ✓')
}
