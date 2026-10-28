// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { vobsPlugin } from './index'

/*
 * `resolveId` and `load` are only 6 lines apart, yet each used a different path
 * representation: `resolveId` returned the **raw** string of `path.resolve(...)`
 * (backslashes on Windows), while Vite hands `load` a **forward-slash** id; `load`
 * matched exactly via `htmlModules.has(id)`, so it never hit → returned null → bare
 * HTML fell through to `vite:import-analysis`, got parsed as JS and threw
 * `Failed to parse source for import analysis because the content contains invalid JS syntax`.
 *
 * The entire HTML component feature was therefore **completely broken on Windows**,
 * and the only existing test touching this seam (index.test.ts:235-243) only asserted
 * that `resolveId`'s return value was truthy and **never fed it back into `load`** —
 * so this broken link was never caught.
 *
 * What this file adds is exactly the missing action: hand resolveId's result to load verbatim.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-html-seam-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

const HTML = '<!doctype html><main>seam</main>\n'

function pluginHooks() {
  const plugin = vobsPlugin({ hmr: false })
  const { resolveId, load } = plugin
  if (typeof resolveId !== 'function' || typeof load !== 'function') {
    throw new Error('Vobs Vite Plugin: missing HTML module hooks')
  }
  return { resolveId, load }
}

describe('HTML component resolveId → load seam', () => {
  it('resolveId result must be POSIX-shaped (Vite id convention)', () => {
    const { resolveId } = pluginHooks()
    const importer = path.join(tempDir, 'Page.tsx')
    const resolved = resolveId.call({} as never, './content.html', importer, { attributes: {}, isEntry: false } as never)
    expect(typeof resolved).toBe('string')
    expect(resolved as string).not.toContain('\\')
    expect(resolved as string).toContain('/')
  })

  it('feeding resolveId\'s result to load verbatim must yield the compiled component', async () => {
    const { resolveId, load } = pluginHooks()
    const htmlFile = path.join(tempDir, 'content.html')
    writeFileSync(htmlFile, HTML, 'utf8')

    const resolved = resolveId.call({} as never, './content.html', path.join(tempDir, 'Page.tsx'), { attributes: {}, isEntry: false } as never) as string
    const code = await load.call({} as never, resolved, { attributes: {}, isEntry: false } as never)
    // Before the fix: on Windows resolved was a backslash string → load returned null → null here
    expect(code).toBeTypeOf('string')
    expect(code as string).toContain('createElement("main")')
  })

  /*
   * The backslash form can **only come from Windows callers**: on POSIX, turning `/tmp/x`
   * into `\tmp\x` does not produce an id any caller would emit (backslash is a legal
   * filename character on POSIX, not a separator). This test previously only ran on
   * Windows locally, so it kept failing on ubuntu CI — masked by an earlier step failing
   * (CI used to die at `Install dependencies`, so the tests never ran).
   */
  it.skipIf(process.platform !== 'win32')('load also recognizes backslash-shaped ids (defensive against caller shapes)', async () => {
    const { resolveId, load } = pluginHooks()
    // Must **first be registered through resolveId**; otherwise it should not be claimed at all (that is another test)
    const importer = path.join(tempDir, 'Backslash.tsx')
    const resolved = resolveId.call({} as never, './content.html', importer, { attributes: {}, isEntry: false } as never) as string
    const backslashed = resolved.replace(/\//gu, '\\')

    // Some caller/platform combinations pass backslash shapes; both shapes must hit,
    // not one hit while the other silently returns null
    const viaBackslash = await load.call({} as never, backslashed, { attributes: {}, isEntry: false } as never)
    expect(viaBackslash).toBeTypeOf('string')
    expect(viaBackslash as string).toContain('createElement("main")')
  })

  it('HTML that was never imported gets no loader (beyond the truthy assertion, assert the null side)', async () => {
    const { load } = pluginHooks()
    const stray = path.join(tempDir, 'stray.html')
    writeFileSync(stray, HTML, 'utf8')
    expect(await load.call({} as never, stray, { attributes: {}, isEntry: false } as never)).toBeNull()
  })
})
