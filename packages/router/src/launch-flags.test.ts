// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

/*
 * Launch flags (hasLaunchFlag / readLaunchQuery) — the standard part for Finora's "URL switch
 * params" pit.
 *
 * Semantics: captured once at module load (SPA-internal navigation rewriting the URL does not
 * affect the captured values); both history form (/?cloud) and hash form (/#/path?cloud) are
 * recognized.
 * Module-level capture = tests use vi.resetModules + dynamic import to re-evaluate.
 */
const freshImport = async (): Promise<typeof import('./index')> => {
  vi.resetModules()
  return await import('./index')
}

describe('launch flags (hasLaunchFlag / readLaunchQuery)', () => {
  it('history form: flags in search are captured', async () => {
    window.history.replaceState(null, '', '/?cloud&shell=cockpit')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('shell')).toBe('cockpit')
    expect(hasLaunchFlag('nonexistent')).toBe(false)
    expect(readLaunchQuery('nonexistent')).toBeNull()
  })

  it('hash form: #/path?cloud is recognized as well', async () => {
    window.history.replaceState(null, '', '/#/workbench?cloud')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('cloud')).toBe('')
  })

  it('readable from both when search and hash segments exist simultaneously', async () => {
    window.history.replaceState(null, '', '/?cloud#/path?shell=cockpit')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('shell')).toBe('cockpit')
  })

  it('capture-once semantics: flags do not drift after SPA navigation rewrites the URL', async () => {
    window.history.replaceState(null, '', '/?cloud')
    const { hasLaunchFlag } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)

    // Route navigation (pushState rewrites the URL, dropping the query) — captured flags are unaffected
    window.history.replaceState(null, '', '/accounts')
    expect(hasLaunchFlag('cloud')).toBe(true)
  })

  it('all return negative when no flags are present', async () => {
    window.history.replaceState(null, '', '/plain')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(false)
    expect(readLaunchQuery('cloud')).toBeNull()
  })
})
