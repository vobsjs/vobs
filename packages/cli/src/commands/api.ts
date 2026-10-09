import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger.js'

/**
 * `vobs api [query]` —— 框架导出的**可查询索引**。
 *
 * ## 为什么需要它
 *
 * LLM 报错的大头是**猜错 API 形状**。这一轮里我自己就栽过三次"能力已存在却不知道"
 * （差点重复实现 `inferStateDebugName`、差点把 `LayoutChildren` 做成破坏性变更、
 * 不知道 `vobs check` 全量扫描）—— 而我有**源码访问权**。GLM 连猜的资格都更差。
 *
 * 与其让它猜，不如给它查。这比任何文档都直接：**模型可以查，不用猜。**
 *
 * ## 数据来源：**已构建的 `dist/*.d.ts`**
 *
 * 读的是**随包发布**的类型声明，所以：
 * - 与用户实际拿到的一致（不是源码的近似）
 * - 版本准确（升级框架后索引自动跟着变）
 *
 * ## 只做名字索引（刻意的范围）
 *
 * 这一版只回答「**哪个包导出了什么名字**」—— 那是最常被猜错的一环，
 * 且能纯静态抽取、零误报。签名/参数（更重、需要类型解析）留作后续。
 *
 * ## 已知限制
 *
 * **还有约 0.7% 的条目不显示种类**（实测 1359 项里 10 项 unknown）。
 * 逐个看过，它们**不是解析缺陷，而是 bundler 的去冲突改名残留**：
 *
 * ```
 * captcha/index.d.ts:2   export { C as Captcha, a as CaptchaAnswer, b as CaptchaChallenge, … }
 * payment/index.d.ts:1   export { i as alipay } from './index-B1aUR7Vt.js'
 * ```
 *
 * 也就是 `a`/`b`/`alipay` 这些名字**确实在导出列表里**（列出来是准确的），
 * 只是它们指向的本地声明（`i` 之类）没有可识别的声明头。
 *
 * **刻意不过滤单字母名**：那能让输出更好看，但会变成"我猜哪些导出不算 API" ——
 * 而这个索引的价值恰恰在于"名字与包名是准的，不编"。
 *
 * **输出里 unknown 不显示那一列**（显示一列"没解析出来"会让人以为工具坏了）；
 * `--json` 仍保留该字段供工具消费。
 *
 * （演进：单遍 → **1353/1355 全 unknown**；两遍法 → 196/1359 = 14%；
 * 补上**别名映射**（`index_X as X`）与**跨包种类回退** → **10/1359 = 0.7%**。
 * 两条修法的原因都写在上面的 `exportAliases` 与 `globalKinds` 注释里。）
 *
 * **不 import 任何工作区包**：只用 node:fs / node:path。
 * 这一轮已经有两次"import 了 workspace 包但没声明依赖"的坑（cwd 一换就炸），
 * 这个命令从设计上避开它。
 */
export interface ApiOptions {
  /** 查询串（子串匹配，大小写不敏感）。省略时列出全部。 */
  readonly query?: string
  /** 机器可读输出（给 AI 与工具消费）。 */
  readonly json?: boolean
  /** 仓库根目录，默认当前工作目录。 */
  readonly dir?: string
}

export interface ApiEntry {
  /** 包名，如 `@vobs/runtime`。 */
  readonly package: string
  /** 导出名，如 `state`。 */
  readonly name: string
  /** 导出种类（函数 / 类型 / 常量 / 类 / 未知）。 */
  readonly kind: 'function' | 'type' | 'const' | 'class' | 'unknown'
}

/**
 * **第一遍**：这一行里被**导出**的名字（不管它是什么）。
 *
 * 只关心"对外可见"—— 因为打包出来的类型声明绝大多数是**再导出桶**
 * （`export { a, b } from './x'`），真正的声明在子文件里，两处不在同一行。
 */
function exportedNames(line: string): string[] {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return []

  // export { a, b as c } / export type { T }
  const group = text.match(/^export\s+(?:type\s+)?\{([^}]*)\}/u)
  if (group) {
    return group[1]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/u)
        return (asMatch ? asMatch[1] : part).replace(/^type\s+/u, '').trim()
      })
      .filter(name => /^[A-Za-z_$][\w$]*$/u.test(name))
  }

  const single = text.match(/^export\s+(?:declare\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/u)
  return single ? [single[1]] : []
}

/**
 * **别名映射**：`export { 本地名 as 公开名 }` 里的 `公开名 → 本地名`。
 *
 * ## 为什么必须有它（实测出来的 14% 的主因之一）
 *
 * 打包器会**改名**。`@vobs/payment/dist/index-B1aUR7Vt.d.ts` 实测：
 *
 * ```ts
 * import { AlipaySdkConfig } from 'alipay-sdk'
 * declare const index_AlipaySdkConfig: typeof AlipaySdkConfig     // ← 声明叫 index_…
 * ```
 *
 * 而导出列表里写的是 `export { index_AlipaySdkConfig as AlipaySdkConfig }`。
 * `exportedNames` 解析出的是**公开名**（`AlipaySdkConfig`），
 * `declarationKinds` 记的是**本地名**（`index_AlipaySdkConfig`）—— 于是永远 join 不上 → `unknown`。
 *
 * 修法是先把别名记下来，join 时用 `公开名 → 本地名 → 种类` 走两步。
 */
function exportAliases(line: string): Array<[publicName: string, localName: string]> {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return []
  const group = text.match(/^export\s+(?:type\s+)?\{([^}]*)\}/u)
  if (!group) return []
  const out: Array<[string, string]> = []
  for (const part of group[1].split(',')) {
    const asMatch = part.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u)
    if (asMatch) out.push([asMatch[2], asMatch[1]])
  }
  return out
}

/**
 * **第二遍**：名字 → 种类。
 *
 * 这里**不要求 `export` 前缀** —— 打包出来的声明常常就是
 * `declare function state(...)`，由文件末尾的 `export { state }` 统一导出。
 *
 * 之前只有一遍、且要求 `export declare …`，于是实测 **1355 项里 1353 项是
 * `unknown`**（见文件头的已知限制）。两遍法把这个数字降下来。
 */
function declarationKinds(text: string): Map<string, ApiEntry['kind']> {
  const kinds = new Map<string, ApiEntry['kind']>()
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    const fn = trimmed.match(/^(?:export\s+)?(?:declare\s+)?function\s+([A-Za-z_$][\w$]*)/u)
    if (fn) { kinds.set(fn[1], 'function'); continue }
    const cls = trimmed.match(/^(?:export\s+)?(?:declare\s+)?class\s+([A-Za-z_$][\w$]*)/u)
    if (cls) { kinds.set(cls[1], 'class'); continue }
    const iface = trimmed.match(/^(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/u)
    if (iface) { kinds.set(iface[1], 'type'); continue }
    const constant = trimmed.match(/^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u)
    if (constant) { kinds.set(constant[1], 'const'); continue }
  }
  return kinds
}

/** 收集一个包 `dist` 下全部 `.d.ts`。 */
function declarationFiles(distDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (entry.name.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(distDir, 0)
  return out
}

/** 建立索引：读每个包的 package.json 拿到真名，再扫它的 dist 类型声明。 */
export function buildApiIndex(root: string): ApiEntry[] {
  const packagesDir = path.join(root, 'packages')
  if (!existsSync(packagesDir)) return []
  const index: ApiEntry[] = []
  /** 已收录的「包|名字」（去重）。 */
  const exported = new Set<string>()
  /** 「包|名字」→ 种类（第二遍收集，最后 join 回 index）。 */
  const kinds = new Map<string, ApiEntry['kind']>()
  /** 「包|公开名」→ 本地名（`export { 本地 as 公开 }`，见 exportAliases 的注释）。 */
  const aliases = new Map<string, string>()
  /**
   * **跨包**的名字 → 种类（不带包名）。
   *
   * 为什么要它：`@vobs/vobs` 是一整行再导出列表（`export { AsyncBoundary, … }`），
   * 而这些名字的声明在**兄弟包**（`@vobs/dom` / `@vobs/kit`）的 dist 里。
   * 按包收集的映射永远查不到 → 实测 `@vobs/vobs` 有 100 条 unknown（占全部 196 的一半）。
   *
   * 只作**回退**用：先查本包（更精确，能区分同名不同包），查不到才用全局。
   */
  const globalKinds = new Map<string, ApiEntry['kind']>()
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = path.join(packagesDir, entry.name)
    let manifest: { name?: string; private?: boolean }
    try { manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) } catch { continue }
    // 内部/未发布的包不进索引（用户装不到它们）
    if (manifest.name === undefined || manifest.private === true) continue
    const distDir = path.join(pkgDir, 'dist')
    if (!existsSync(distDir)) continue
    for (const file of declarationFiles(distDir)) {
      let text: string
      try { text = readFileSync(file, 'utf8') } catch { continue }
      /*
       * **两遍法**：
       *  1. 先收「这个名字是什么」（声明常常不带 export 前缀 → 之前全被漏掉）
       *  2. 再收「这个名字被导出了」（导出列表与声明不在同一行）
       *  3. 最后 join：导出名 → 种类
       * 顺序无所谓（各写各的 map），但**必须两遍** —— 只有一遍时 1353/1355 是 unknown。
       */
      for (const [name, kind] of declarationKinds(text)) {
        kinds.set(`${manifest.name}|${name}`, kind)
        if (!globalKinds.has(name)) globalKinds.set(name, kind)
      }
      for (const line of text.split(/\r?\n/u)) {
        for (const [publicName, localName] of exportAliases(line)) {
          aliases.set(`${manifest.name}|${publicName}`, localName)
        }
        for (const name of exportedNames(line)) {
          const key = `${manifest.name}|${name}`
          if (exported.has(key)) continue
          exported.add(key)
          index.push({ package: manifest.name, name, kind: 'unknown' })
        }
      }
    }
  }
  /*
   * join：导出名 → 种类。三步回退，每一步都只在前一步失败时才用：
   *   ① 本包同名声明（最精确）
   *   ② 解别名后的本包声明（bundler 改名，如 `index_AlipaySdkConfig as AlipaySdkConfig`）
   *   ③ 全局同名声明（跨包再导出，如 vobs → dom/kit）
   * 都查不到就保持 unknown —— **不编造**。
   */
  for (const item of index) {
    const direct = kinds.get(`${item.package}|${item.name}`)
    if (direct !== undefined) { (item as { kind: ApiEntry['kind'] }).kind = direct; continue }
    let localName = aliases.get(`${item.package}|${item.name}`)
    // 别名可能链式（a as b、b as c）；解析几轮足够，避免环导致的死循环
    for (let hop = 0; hop < 4 && localName !== undefined; hop++) {
      const byAlias = kinds.get(`${item.package}|${localName}`)
      if (byAlias !== undefined) { (item as { kind: ApiEntry['kind'] }).kind = byAlias; break }
      localName = aliases.get(`${item.package}|${localName}`)
    }
    if ((item as { kind: ApiEntry['kind'] }).kind !== 'unknown') continue
    const fallback = globalKinds.get(item.name)
    if (fallback !== undefined) (item as { kind: ApiEntry['kind'] }).kind = fallback
  }
  return index.sort((a, b) => a.name.localeCompare(b.name) || a.package.localeCompare(b.package))
}

export async function apiCommand(options: ApiOptions = {}): Promise<void> {
  const root = path.resolve(options.dir ?? process.cwd())
  const index = buildApiIndex(root)
  if (index.length === 0) {
    logger.error('没有找到索引数据。先构建：pnpm run build:packages')
    process.exitCode = 1
    return
  }

  const query = options.query?.trim()
  const hits = query === undefined || query === ''
    ? index
    : index.filter(item =>
      item.name.toLowerCase().includes(query.toLowerCase())
      || item.package.toLowerCase().includes(query.toLowerCase()))

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({ query: query ?? null, total: index.length, hits }, null, 2)}\n`)
    return
  }

  if (hits.length === 0) {
    logger.error(`没有匹配 "${query}" 的导出。`)
    console.log('（索引来自已构建的 dist 类型声明 —— 若刚加了导出，先 pnpm run build:packages。）')
    process.exitCode = 1
    return
  }

  console.log(query === undefined || query === ''
    ? `框架导出索引（${index.length} 项，按名排序）：\n`
    : `匹配 "${query}" 的导出（${hits.length}/${index.length}）：\n`)
  for (const item of hits) {
    // kind 为 unknown 时不显示那一列 —— 它是'没解析出来'，不是'这个导出没有种类'
    const kind = item.kind === 'unknown' ? '' : item.kind
    console.log(`  ${item.name.padEnd(34)} ${item.package.padEnd(22)} ${kind}`.trimEnd())
  }
  if (hits.length > 60) console.log(`\n（还有 ${hits.length - 60} 项，用 --json 拿全量）`)
}
