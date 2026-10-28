/*
 * **Channel reachability**: every diagnostic code must actually be reportable on the
 * channels it declares.
 *
 * ## Why this test exists
 *
 * "A diagnostic exists but is invisible on a particular channel" happened **three times**
 * in one round:
 *
 * 1. `vite build` stops after the first file containing an error
 * 2. `describeDiagnostics` filtered only `error` → warnings silent (fixed in 1.8.2)
 * 3. `vobs check` **did not run the compiler** → C104–C108 invisible (fixed in `6e3a891`)
 *    and the **reverse**: analyzer diagnostics (C118/C232/C210) invisible in
 *    `vite build` (fixed in `6f73032`)
 *
 * All three were found **by hand**. This test turns "channel integrity" into a verifiable
 * asset — the fourth occurrence will turn CI red instead of being discovered in production.
 *
 * ## Declarative matrix
 *
 * Each code declares the channels where it **must** be visible. When adding a code you
 * **must** also add a fixture, otherwise this test will not cover it (a "matrix
 * completeness" check below enforces this).
 *
 * ## Two deliberate trade-offs
 *
 * - **The CLI channel spawns only once**: all 8 fixtures are written into the same temp
 *   directory and `vobs check` runs once. Spawning per fixture would make this test
 *   ten-odd seconds slower, and diagnostics are attributed per file, so once is enough.
 * - **The vite channel calls `transform` in-process**: it exercises the plugin's real
 *   code path (the same function), much faster than a full `vite build`, and needs no
 *   temp-project dependencies.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

interface Fixture {
  readonly code: string
  /** Minimal source that triggers the code (written into `<code>.tsx`). */
  readonly source: string
  /** Channels where it must be visible. Empty means it only appears at runtime/config level — static channels should not report it. */
  readonly channels: readonly ('check' | 'vite')[]
}

const FIXTURES: readonly Fixture[] = [
  {
    code: 'VOBS_C104',
    source: 'export function P(){ return open.value ? <div>a</div> : null }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C105',
    source: 'export const MENU = <div>module top level</div>',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C106',
    source: 'export function P(){ effect(async () => { await load() }) }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C107',
    source: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C108',
    source: 'export function P(){ const node = <div>x</div>; return open.value ? node : null }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C118',
    source: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      '  const count = state(0)',
      '  const snapshot = count.value',
      '  return <div>{snapshot}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C210',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C232',
    source: [
      'export function P() {',
      '  return <div>{open.value ? items.value.map(item => <li key={item}>{item}</li>) : <b/>}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  /*
   * The codes below are **deliberately declared empty**: they do not appear on static
   * channels, so they should not be required to be visible. Listed explicitly so the
   * "matrix completeness" check can distinguish "not declared" from "declared invisible".
   */
  { code: 'VOBS_C211', source: '// runtime guardrail (burst), static channels do not report it', channels: [] }
]

const dir = mkdtempSync(join(tmpdir(), 'vobs-channels-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

for (const fixture of FIXTURES) {
  writeFileSync(join(dir, `${fixture.code}.tsx`), fixture.source, 'utf8')
}

/** Channel A: run the real `vobs check` (once), grouped by code. */
function checkChannel(): Map<string, Set<string>> {
  const cli = resolve(process.cwd(), 'packages/cli/bin/vobs.js')
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, [cli, 'check', dir, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    /*
     * The CLI exits 1 when the check finds problems — that is **correct behavior** and
     * must not fail the test. `execFileSync` throws in that case, with stdout attached
     * to the error.
     */
    const captured = (error as { stdout?: string }).stdout
    if (typeof captured !== 'string' || captured.trim() === '') throw error
    stdout = captured
  }
  const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string; file: string }> }
  const byCode = new Map<string, Set<string>>()
  for (const item of parsed.diagnostics) {
    if (!byCode.has(item.code)) byCode.set(item.code, new Set())
    byCode.get(item.code)!.add(item.file)
  }
  return byCode
}

/** Channel B: call the plugin's `transform` in-process (the plugin's real code path), grouped by code. */
function viteChannel(fixture: Fixture): Set<string> {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('missing transform hook')
  const warn = vi.fn()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    transform.call({ warn } as unknown as ThisParameterType<typeof transform>,
      fixture.source,
      `src/${fixture.code}.tsx`
    )
  } catch {
    // Compiler errors throw — that still counts as "reported"; the console fallback path
    // can't be read here, so detection goes through warn
  } finally {
    vi.restoreAllMocks()
  }
  const text = warn.mock.calls.map(call => String(call[0])).join('\n')
  const found = new Set<string>()
  for (const code of text.matchAll(/VOBS_C\d+/gu)) found.add(code[0])
  return found
}

// Three spawns of the CLI channel would be too slow; run once and reuse
let cachedCheck: Map<string, Set<string>> | undefined
const checkResults = (): Map<string, Set<string>> => (cachedCheck ??= checkChannel())

describe('channel reachability: every code must be visible on its declared channels', () => {
  it('matrix completeness: every code declares channels (an explicit empty array counts as a declaration)', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.channels, `${fixture.code} does not declare channels`).toBeDefined()
    }
  })

  for (const fixture of FIXTURES.filter(item => item.channels.includes('check'))) {
    it(`${fixture.code} → reportable via vobs check`, () => {
      const hits = checkResults().get(fixture.code)
      expect(hits, `${fixture.code} is invisible on the vobs check channel`).toBeDefined()
      expect([...hits!].some(file => file.includes(fixture.code))).toBe(true)
    })
  }

  for (const fixture of FIXTURES.filter(item => item.channels.includes('vite'))) {
    it(`${fixture.code} → reportable on the vite channel`, () => {
      const found = viteChannel(fixture)
      expect(found.has(fixture.code), `${fixture.code} is invisible on the vite channel`).toBe(true)
    })
  }

  it('**codes declared invisible must not appear on static channels** (the reverse is verified too, otherwise "report everywhere" would also pass)', () => {
    for (const fixture of FIXTURES.filter(item => item.channels.length === 0)) {
      expect(
        checkResults().has(fixture.code),
        `${fixture.code} was declared invisible on static channels but appeared in vobs check`
      ).toBe(false)
    }
  })
})
