import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DIAGNOSTIC_GUIDES, findDiagnosticGuide } from '@vobs/runtime'
import { logger } from '../utils/logger.js'

/**
 * `vobs explain [code]` —— 诊断码的**可查询说明**（Rust 的 `rustc --explain` 模式）。
 *
 * ## 为什么需要
 *
 * 这一轮里 `C104`–`C108` 的规则都是**读源码**才知道的；AI 只看到错误信息那一句。
 * Rust 生态被认为"对人不友好但 AI 友好"，很大程度就是因为规则**可以查，不用猜**。
 *
 * ## 三种用法
 *
 * ```
 * vobs explain VOBS_C210     # 单个码：是什么 / 为什么 / 正确写法 / 反例
 * vobs explain               # 列出全部已收录的码
 * vobs explain --json        # 机器可读（给 AI 与工具消费）
 * vobs explain --missing     # 列出**源码里存在但没有条目**的码（诚实标注覆盖缺口）
 * ```
 *
 * `--missing` 是刻意加的：**猜的文档比没有文档更糟**，所以缺口要能被看见，
 * 而不是让使用者以为"框架只有这几个码"。
 */
export interface ExplainOptions {
  readonly code?: string
  readonly json?: boolean
  readonly missing?: boolean
  /** 源码根目录（`--missing` 用），默认当前工作目录。 */
  readonly dir?: string
}

/** 从框架源码里扫出全部 `VOBS_C\d+`（用于 `--missing`）。 */
function collectCodesFromSource(root: string): string[] {
  const found = new Set<string>()
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!/\.tsx?$/u.test(entry.name) || /\.test\./u.test(entry.name)) continue
      let text: string
      try { text = readFileSync(full, 'utf8') } catch { continue }
      for (const match of text.matchAll(/VOBS_C\d{3}(?!\d)/gu)) found.add(match[0])
    }
  }
  walk(root, 0)
  return [...found].sort()
}

export async function explainCommand(options: ExplainOptions = {}): Promise<void> {
  if (options.missing === true) {
    const root = path.resolve(options.dir ?? process.cwd())
    const packages = path.join(root, 'packages')
    const fromSource = collectCodesFromSource(existsSync(packages) ? packages : root)
    const covered = new Set(DIAGNOSTIC_GUIDES.map(item => item.code))
    const missing = fromSource.filter(code => !covered.has(code))
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify({ covered: [...covered].sort(), missing }, null, 2)}\n`)
      return
    }
    console.log(`已收录 ${covered.size} 个码；源码里还有 ${missing.length} 个没有条目：`)
    for (const code of missing) console.log(`  ${code}`)
    if (missing.length > 0) {
      console.log('\n（这些码目前只在源码里有 message。缺口是**已知**的，不假装覆盖。）')
    }
    return
  }

  if (options.code === undefined) {
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(DIAGNOSTIC_GUIDES, null, 2)}\n`)
      return
    }
    console.log('vobs 诊断码说明（vobs explain <code> 看详情）：\n')
    for (const item of DIAGNOSTIC_GUIDES) {
      console.log(`  ${item.code}  [${item.severity}]  ${item.title}`)
    }
    console.log('\n机器可读：vobs explain --json ｜ 覆盖缺口：vobs explain --missing')
    return
  }

  const code = options.code.toUpperCase().startsWith('VOBS_')
    ? options.code.toUpperCase()
    : `VOBS_${options.code.toUpperCase()}`
  const guide = findDiagnosticGuide(code)
  if (guide === undefined) {
    logger.error(`${code} 没有说明条目。`)
    console.log('（没有条目时**不编** —— 猜的文档比没有文档更糟。）')
    console.log('已收录的码：')
    for (const item of DIAGNOSTIC_GUIDES) console.log(`  ${item.code}`)
    process.exitCode = 1
    return
  }

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(guide, null, 2)}\n`)
    return
  }
  console.log(`${guide.code}  [${guide.severity}]`)
  console.log(`\n${guide.title}\n`)
  console.log('为什么是坑：')
  console.log(`  ${guide.why}`)
  console.log('\n正确写法：')
  console.log(`  ${guide.correct}`)
  console.log('\n反例：')
  console.log(`  ${guide.wrong}`)
}
