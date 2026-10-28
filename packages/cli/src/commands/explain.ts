import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DIAGNOSTIC_GUIDES, findDiagnosticGuide } from '@vobs/runtime'
import { logger } from '../utils/logger.js'

/**
 * `vobs explain [code]` — **queryable explanations** for diagnostic codes
 * (Rust's `rustc --explain` pattern).
 *
 * ## Why it is needed
 *
 * The `C104`–`C108` rules in this round are only knowable by **reading the source**;
 * an AI sees just the one error line. The Rust ecosystem is considered
 * "unfriendly to humans but AI-friendly" largely because its rules **can be queried, not guessed**.
 *
 * ## Three usages
 *
 * ```
 * vobs explain VOBS_C210     # single code: what / why / correct form / counter-example
 * vobs explain               # list all covered codes
 * vobs explain --json        # machine-readable (for AI and tools)
 * vobs explain --missing     # list codes that **exist in the source but have no entry** (honestly marking coverage gaps)
 * ```
 *
 * `--missing` is deliberate: **guessed documentation is worse than none**, so gaps must
 * stay visible instead of letting users believe "the framework only has these codes".
 */
export interface ExplainOptions {
  readonly code?: string
  readonly json?: boolean
  readonly missing?: boolean
  /** Source root directory (used by `--missing`); defaults to the current working directory. */
  readonly dir?: string
}

/** Scan all `VOBS_C\d+` codes out of the framework source (used by `--missing`). */
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
    console.log(`${covered.size} codes covered; ${missing.length} codes in the source still have no entry:`)
    for (const code of missing) console.log(`  ${code}`)
    if (missing.length > 0) {
      console.log('\n(These codes currently only have a message in the source. The gap is **known** — coverage is not faked.)')
    }
    return
  }

  if (options.code === undefined) {
    if (options.json === true) {
      /*
       * **Stable schema contract** (2026-10-28): the field set of this output
       * (code/severity/title/why/correct/wrong/rewrites) is as stable as the diagnostic
       * codes themselves — additive-only; nothing is removed or reshaped within a minor
       * release. AI can trust the structure of `vobs explain --json <code>` and parse
       * `rewrites[].wrong → .correct` for mechanical rewrites (guide-verification
       * guarantees the after form yields zero diagnostics).
       */
      process.stdout.write(`${JSON.stringify(DIAGNOSTIC_GUIDES, null, 2)}\n`)
      return
    }
    console.log('vobs diagnostic code reference (run vobs explain <code> for details):\n')
    for (const item of DIAGNOSTIC_GUIDES) {
      console.log(`  ${item.code}  [${item.severity}]  ${item.title}`)
    }
    console.log('\nMachine-readable: vobs explain --json | Coverage gaps: vobs explain --missing')
    return
  }

  const code = options.code.toUpperCase().startsWith('VOBS_')
    ? options.code.toUpperCase()
    : `VOBS_${options.code.toUpperCase()}`
  const guide = findDiagnosticGuide(code)
  if (guide === undefined) {
    logger.error(`${code} has no explanation entry.`)
    console.log('(When there is no entry, we **do not invent one** — guessed documentation is worse than none.)')
    console.log('Covered codes:')
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
  console.log('Why it is a trap:')
  console.log(`  ${guide.why}`)
  console.log('\nCorrect form:')
  console.log(`  ${guide.correct}`)
  console.log('\nCounter-example:')
  console.log(`  ${guide.wrong}`)
}
