/**
 * `vobs check` — the list of source problems it can produce without running the app.
 *
 * Why it is needed: the easiest mistakes to make in vobs are the **silent** ones
 * (effect self-subscription, a list placed inside a ternary branch losing keyed reuse).
 * The runtime guardrails (`@vobs/vobs/dev`) can catch those, but that requires booting the
 * app first; static checking lets you (and AI) know what is wrong **after writing,
 * before running**.
 *
 * The output shares one vocabulary with the rest of the framework (code / severity / fix);
 * the fields map directly onto `VobsError` from `@vobs/runtime/error`, so it can be fed
 * straight into a devtools panel or an AI.
 *
 * The high precision of the rules is deliberate: rather under-report than mis-report —
 * false positives make AI "fix" code that was already correct.
 *
 * ## Known limitations
 *
 * All the rules are **heuristics** (based on names and shapes), so they can hit legal code:
 *
 * - `VOBS_C210`: treats "read + write of the same `X.value`" as signal self-subscription.
 *   It **cannot tell a signal apart from an ordinary field that happens to be named `value`**
 *   — `entry.value = x` (DTO / ref / config object) gets mis-reported. Narrowing it to
 *   "bare identifiers only" would also let real signals like `props.name.value` slip
 *   through, so it stays as-is + offers inline suppression.
 * - `VOBS_C232` / `VOBS_C118`: the former checks "whether the list expression sits inside a
 *   branch", the latter "whether the component body stores a signal read into a local
 *   variable". Both are shape-only; no type inference.
 * - `VOBS_C233`: in-place array mutation (`list.value.push(...)`) only warns for receivers
 *   whose **name is verifiably bound to `state(...)`** — this binding analysis makes it the
 *   lowest false-positive risk of the four; arrays produced by custom store factories are
 *   not recognized (false negatives, never false positives).
 *
 * When you hit a false positive, the sanctioned remedy is **inline suppression**
 * (`// vobs-check-ignore-next-line`), not disabling the whole rule or rewriting correct code.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { compileWithSourceMap } from '@vobs/compiler'
import { analyzeSource, type CheckDiagnostic } from '@vobs/compiler'
import path from 'node:path'
import { checkContractSync } from './agent-doc.js'
import { logger } from '../utils/logger.js'

export interface CheckOptions {
  readonly dir?: string
  readonly json?: boolean
  /** Write the report to `<root>/.vobs/check.json` (the devtools panel reads this file for the "project" page). */
  readonly write?: boolean
  /** Include test files in the check (skipped by default: intentional patterns in fixtures would drown real problems). */
  readonly includeTests?: boolean
  /**
   * Also run **compiler** diagnostics (default true).
   *
   * Why the compiler must be merged: if `vobs check` only runs `analyzeSource`
   * (C118/C210/C232), the compiler's five diagnostics (C104/C105/C106/C107/C108) become
   * **invisible in the batch entry** — a file with module-top-level JSX would report
   * "check passed". **A silent channel means the diagnostic does not exist.**
   *
   * The cost is one extra compile per file — use `--no-compiler` when you need speed.
   */
  readonly compiler?: boolean
}

/** Fixed report location, relative to the checked root directory. */
export const REPORT_PATH = '.vobs/check.json'

/** Test files are skipped by default. */
const TEST_FILE = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.tsx?|__tests__\/)/u


const SKIP_DIRS = new Set(['node_modules', 'dist', 'lib', 'build', '.git', '.vobs', 'coverage'])

/**
 * Collect .ts/.tsx files under the target.
 *
 * When the **root directory** cannot be read it **must throw**, never return an empty
 * array: `catch { return }` would turn a nonexistent directory, or "a file passed in by
 * mistake", into `0 files` + exit 0 — a mistyped path in CI then means a **permanent green
 * light**, which is more dangerous than an error (a checker silently passing in exactly
 * the scenario where it should fail).
 *
 * Unreadable subdirectories are still skipped (permission issues / racy deletion should not
 * fail the whole check) — that is intentional tolerance, and not the same thing as
 * "the root does not exist".
 */
async function collectSources(root: string): Promise<string[]> {
  let rootStat
  try {
    rootStat = await stat(root)
  } catch {
    throw new Error(`Path does not exist: ${root}`)
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Not a directory: ${root} (vobs check accepts a directory)`)
  }

  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // The root vanishing after the first stat (race) must also surface, not blend into "0 files"
      if (dir === root) {
        throw new Error(`Cannot read directory: ${root} (${error instanceof Error ? error.message : String(error)})`)
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

/* ------------------------------------------------------------------ utils */

/** Compile diagnostics for one file. */
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
    // Deduplicate against analyzeSource results (the two rule sets occasionally share codes)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      code: item.code,
      severity: item.severity,
      message: item.message,
      // fix is a required field: when the compiler gives none, still provide an actionable direction
      fix: item.fix ?? 'See the guide for this diagnostic code (`vobs explain` or the framework docs).',
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
    // An invalid path must be a **failure**, never "0 files, check passed" (see collectSources note)
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

  /*
   * Contract version sync (meta-principle: for a contract that ships with the framework
   * version, consistency must be a verifiable fact). agent-doc --check is a standalone
   * command, but this is the main entry for AI / CI — if contract drift were only
   * discoverable by proactively running --check, it would repeat the "the diagnostic
   * exists but the main channel cannot see it" problem. Only projects that already
   * generated a contract get the notice (drifted); missing / no-block are not drift — stay
   * silent. Warning level: does not change the exit code, matching "doc drift does not
   * block the build".
   */
  const contractSync = checkContractSync(root)
  const contractWarnings = contractSync.status === 'drifted' ? contractSync.problems : []

  if (options.write === true) {
    const target = path.join(root, REPORT_PATH)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    // With --json, stdout must contain only JSON, so this notice goes through logger (stderr)
    logger.info(`Report written to ${REPORT_PATH} (the devtools panel reads it for the "project" page)`)
  }

  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2))
    if (errors.length > 0) process.exitCode = 1
    return
  }

  if (diagnostics.length === 0) {
    logger.success(`Check passed — ${files.length} files${skipped > 0 ? ` (${skipped} test files skipped)` : ''}, no problems found`)
    for (const problem of contractWarnings) logger.warn(`${problem}\n  → run \`vobs agent-doc --write\` to sync the contract`)
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
    `  ${errors.length} errors · ${warnings} warnings · checked ${files.length} files`
    + `${skipped > 0 ? ` (${skipped} test files skipped; include them with --include-tests)` : ''}\n`
  )
  for (const problem of contractWarnings) logger.warn(`${problem}\n  → run \`vobs agent-doc --write\` to sync the contract`)

  if (errors.length > 0) process.exitCode = 1
}


// Re-exported from here after the move to @vobs/compiler, so existing importers keep working
export { analyzeSource, VOBS_C118, VOBS_C120, VOBS_C210, VOBS_C232, VOBS_C233, VOBS_C234 } from '@vobs/compiler'
export type { CheckDiagnostic } from '@vobs/compiler'
