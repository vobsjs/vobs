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
 * ## 已知限制（实测，不掩盖）
 *
 * **`kind` 目前基本解析不出来**（实测 1355 项里 1353 项是 unknown）：`dist/*.d.ts`
 * 主要是**再导出桶**（`export { a, b } from './x'`），而子文件里的真正声明用的是
 * `declare function x(...)` —— **没有 `export` 前缀**，所以按 `export declare …` 匹配会漏。
 *
 * 要修得做**两遍**：先收集"被导出的名字"（从各处 `export {…}`），再把名字与
 * 各 `.d.ts` 里的声明种类**关联**起来。那是下一步，不是现在 ——
 * 而**名字 + 包名**这一版已经能回答最常见的问题（"这东西在哪个包"）。
 *
 * 输出里 kind 为 unknown 时**不显示那一列**：显示一个 99% 都是 unknown 的列，
 * 会让人以为工具坏了。
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

/** 从一行 `.d.ts` 里认出导出名与种类。 */
function classify(line: string): { names: string[]; kind: ApiEntry['kind'] } | undefined {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return undefined

  // export { a, b as c } / export type { T }
  const group = text.match(/^export\s+(type\s+)?\{([^}]*)\}/u)
  if (group) {
    const isType = group[1] !== undefined
    const names = group[2]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/u)
        return (asMatch ? asMatch[1] : part).replace(/^type\s+/u, '').trim()
      })
      .filter(name => /^[A-Za-z_$][\w$]*$/u.test(name))
    return names.length > 0 ? { names, kind: isType ? 'type' : 'unknown' } : undefined
  }

  const fn = text.match(/^export\s+declare\s+function\s+([A-Za-z_$][\w$]*)/u)
  if (fn) return { names: [fn[1]], kind: 'function' }
  const cls = text.match(/^export\s+declare\s+class\s+([A-Za-z_$][\w$]*)/u)
  if (cls) return { names: [cls[1]], kind: 'class' }
  const iface = text.match(/^export\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/u)
  if (iface) return { names: [iface[1]], kind: 'type' }
  const constant = text.match(/^export\s+declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u)
  if (constant) return { names: [constant[1]], kind: 'const' }
  return undefined
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
  const seen = new Set<string>()
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
      for (const line of text.split(/\r?\n/u)) {
        const found = classify(line)
        if (found === undefined) continue
        for (const name of found.names) {
          const key = `${manifest.name}|${name}`
          if (seen.has(key)) continue
          seen.add(key)
          index.push({ package: manifest.name, name, kind: found.kind })
        }
      }
    }
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
