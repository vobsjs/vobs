// @vitest-environment node

import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/*
 * The CLI's entire **argument-parsing / exit-code / stdout-vs-stderr routing** layer
 * previously had zero coverage: `check.test.ts` and `dsh.test.ts` only assert pure
 * functions (analyzeSource, collectIssues, buildInstallSpec …), and **no test ever spawned
 * the CLI process**. None of the following defects could have been caught:
 *
 * - `vobs nosuchcmd` / `vobs --totally-unknown` → exit 0 + zero output (no fallback in cac, none in start() either)
 * - `vobs check <nonexistent dir>` → `✔ Check passed — 0 files` + exit 0 (readdir failure swallowed by an empty catch)
 *   — a mistyped path in CI means a **permanent green light**
 * - `vobs --version` printed the **hard-coded** constant `𝗩𝗢𝗕𝗦 𝗖𝗟𝗜 𝘃𝟭.𝟬`, disagreeing with package.json
 * - `vobs check --version` only printed the banner and check never ran (`args.includes('--version')` short-circuits before dispatch)
 *
 * Actually spawning the process is the only way to verify this layer (in-process assertions
 * would mock away stdout routing and exit codes together).
 */
/*
 * Paths come from `process.cwd()` (vitest's cwd is the repo root) — the same convention the
 * repo's existing tests use (theme/css-variable-contract.test.ts, tailwind/layer-order.test.ts).
 * An earlier version derived the repo root via `new URL('..', import.meta.url)`; measured,
 * `import.meta.url`'s base here is not this test file and it resolved to C:\Users\ck\Desktop
 * — silently off by one level.
 */
const repoRoot = process.cwd()
const binPath = path.join(repoRoot, 'packages', 'cli', 'bin', 'vobs.js')
const cliVersion = (JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8')
) as { version: string }).version

const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-cli-proc-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

interface RunResult { code: number; stdout: string; stderr: string }

function runCli(args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(process.execPath, [binPath, ...args], { cwd: tempDir, timeout }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

// Every spawn boots tsx's ESM loader; measured 1.4–1.5s locally, hence the generous timeout
const CLI_TIMEOUT = 60_000

describe('vobs CLI process-level contract', () => {
  it('unknown subcommand: goes to stderr with exit 1 (previously exit 0 + zero output)', async () => {
    const result = await runCli(['nosuchcommand'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown command')
    expect(result.stderr).toContain('nosuchcommand')
  }, CLI_TIMEOUT)

  it('unknown top-level option: goes to stderr with exit 1', async () => {
    const result = await runCli(['--totally-unknown'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown option')
  }, CLI_TIMEOUT)

  it('--version prints the real version number, not a hard-coded constant', async () => {
    const result = await runCli(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`v${cliVersion}`)
    // The former hard-coding: mathematical bold 𝟭.𝟬
    expect(result.stdout).not.toContain('𝟭.𝟬')
  }, CLI_TIMEOUT)

  it('check on a nonexistent directory: exit 1, never prints "Check passed"', async () => {
    const missing = path.join(tempDir, 'definitely-not-here')
    const result = await runCli(['check', missing])
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('Check passed')
    expect(result.stderr).toContain('Path does not exist')
  }, CLI_TIMEOUT)

  it('check on a file instead of a directory: exit 1, never prints "Check passed"', async () => {
    const file = path.join(tempDir, 'not-a-dir.json')
    writeFileSync(file, '{}\n', 'utf8')
    const result = await runCli(['check', file])
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('Check passed')
    expect(result.stderr).toContain('Not a directory')
  }, CLI_TIMEOUT)

  it('check actually runs (control): a clean directory gives exit 0 and prints "Check passed"', async () => {
    const clean = path.join(tempDir, 'clean-src')
    mkdirSync(clean, { recursive: true })
    writeFileSync(path.join(clean, 'ok.tsx'), 'export const A = () => <div>ok</div>\n', 'utf8')
    const result = await runCli(['check', clean])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Check passed')
  }, CLI_TIMEOUT)

  it('check --json stdout is **pure JSON** (directly JSON.parse-able)', async () => {
    const clean = path.join(tempDir, 'json-src')
    mkdirSync(clean, { recursive: true })
    writeFileSync(path.join(clean, 'ok.tsx'), 'export const A = () => <div>ok</div>\n', 'utf8')

    const plain = await runCli(['check', clean, '--json'])
    expect(plain.code).toBe(0)
    expect(() => JSON.parse(plain.stdout)).not.toThrow()

    /*
     * Key contrast: with `--write` added, stdout must **still** be pure JSON.
     * Previously `logger.info('report written …')` printed a timestamped
     * `[14:24:23] ℹ …` line to stdout, so `JSON.parse(stdout)` failed outright —
     * and `--json` is a machine interface consumed by AI and the devtools panel,
     * which made it effectively useless. Fix: logger info/warn go to stderr; stdout keeps only data.
     */
    const withWrite = await runCli(['check', clean, '--json', '--write'])
    expect(withWrite.code).toBe(0)
    expect(() => JSON.parse(withWrite.stdout)).not.toThrow()
    // The notice did not disappear; it just moved to stderr
    expect(withWrite.stderr).toContain('Report written')
  }, CLI_TIMEOUT)

  it('check exits 1 when error-level problems are found (ensures the previous test is not "always passes")', async () => {
    const bad = path.join(tempDir, 'bad-src')
    mkdirSync(bad, { recursive: true })
      /*
       * Use an **error-level** diagnostic as the fixture.
       *
       * This originally used C210 (effect self-subscription), but its **static rule had been
       * downgraded to warning**: the rule judges by signal variable name and had a measured
       * false positive (same-named local shadowing), while error level would fail CI for
       * correct code (the C104 mistake pattern). The real hard gate is the runtime guardrail
       * (judged on the actual dependency set).
       *
       * Switched to C101 (unsupported JSX tag shape) — a stable error, and after the merge
       * in 6e3a891, vobs check also sees the compiler's diagnostics.
       */
      writeFileSync(
        path.join(bad, 'bad.tsx'),
        'export const A = () => <svg:rect />' + '\n',
        'utf8'
      )
      const result = await runCli(['check', bad])
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('VOBS_C101')
      expect(result.stdout).toContain('1 errors')
  }, CLI_TIMEOUT)
})
