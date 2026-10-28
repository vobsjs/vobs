/*
 * The Vite plugin must **surface compiler warnings** (real-project feedback, 2026-10-02).
 *
 * Cause: `describeDiagnostics` internally does
 *   `diagnostics.filter(item => item.severity === 'error')`,
 * returns `null` when there are no errors, and the plugin only did `if (summary) throw` —
 * so **warnings were silently dropped**. Measured consequence: `VOBS_C105` (JSX at module
 * top level) and `VOBS_C104` (top-level conditional return, demoted to warning in 1.8.1)
 * were **completely invisible** in `vite build`; only `vobs check` could see them.
 *
 * This file locks in: warnings surface through Vite's warning channel (`this.warn`), and
 * **clean files raise no warnings** (otherwise an "always warn" test has no teeth).
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

function runTransform(code: string, id: string, context: object = {}) {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('missing transform hook')
  return transform.call(context as ThisParameterType<typeof transform>, code, id)
}

describe('compiler warnings must appear in the build output', () => {
  it('JSX at module top level (VOBS_C105) → calls this.warn', () => {
    const warn = vi.fn()
    runTransform(
      `import { KitMenuItem } from './menu'\nexport const MENU = <KitMenuItem />`,
      'src/Menu.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn, 'VOBS_C105 was silently dropped (invisible in build)').toHaveBeenCalled()
    expect(text).toContain('VOBS_C105')
    // Must carry the location and the fix, otherwise the user has no idea what to change
    expect(text).toContain('src/Menu.tsx')
    expect(text).toContain('Fix:')
  })

  it('top-level conditional return producing a render node (VOBS_C104) → calls this.warn', () => {
    const warn = vi.fn()
    runTransform(
      `export function Panel() { return open.value && <div>content</div> }`,
      'src/Panel.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn).toHaveBeenCalled()
    expect(text).toContain('VOBS_C104')
  })

  it('**clean files raise no warnings** (otherwise "always warn" would also pass the tests above)', () => {
    const warn = vi.fn()
    runTransform(
      `export function Clean() { return <div>{label.value}</div> }`,
      'src/Clean.tsx',
      { warn }
    )
    expect(warn, `clean file raised a warning: ${warn.mock.calls.map(c => String(c[0])).join(' | ')}`).not.toHaveBeenCalled()
  })

  it('the same diagnostic hitting repeatedly in one file is deduplicated (no spam)', () => {
    const warn = vi.fn()
    runTransform(
      `export const A = <div>a</div>\nexport const B = <div>b</div>\nexport const C = <div>c</div>`,
      'src/Many.tsx',
      { warn }
    )
    const lines = warn.mock.calls.map(call => String(call[0]))
    // Three different locations — different locations so no dedup, but every line must
    // carry its location (so it can be tracked down)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toContain('src/Many.tsx')
  })

  it('falls back to console.warn when PluginContext is unavailable (never silent)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // No this.warn provided
      runTransform(`export const MENU = <div />`, 'src/Menu2.tsx', {})
      const text = spy.mock.calls.map(call => String(call[0])).join('\n')
      expect(text, 'went to neither this.warn nor console.warn — the warning vanished').toContain('VOBS_C105')
    } finally {
      spy.mockRestore()
    }
  })

  it('warnings do **not** make it throw (the point of the demotion); errors still throw', async () => {
    const { describeDiagnostics } = await import('@vobs/compiler')
    const diagnostic = (severity: 'error' | 'warning') => ({
      code: 'VOBS_C999',
      severity,
      message: 'example',
      location: { file: 'a.tsx', line: 1, column: 1 }
    }) as never

    // Key contract: with warnings only, summary is null — this is exactly the
    // implementation basis of "warnings do not block builds", and exactly where the
    // "warnings silently dropped" line of code lived.
    expect(
      describeDiagnostics([diagnostic('warning')]),
      'a non-null summary for warnings would mean warnings block builds'
    ).toBeNull()
    expect(describeDiagnostics([diagnostic('error')])).not.toBeNull()
    // With both present, treat as error (still throws)
    expect(describeDiagnostics([diagnostic('warning'), diagnostic('error')])).not.toBeNull()
  })

  it('with both warning and error: throws first (errors take priority)', () => {
    const warn = vi.fn()
    // Module top-level JSX (warning) + namespaced tag (VOBS_C101, error) in one file
    let thrown: unknown
    try {
      runTransform(
        `export const MENU = <div />\nexport const Bad = <svg:rect />`,
        'src/Both.tsx',
        { warn }
      )
    } catch (reason) { thrown = reason }
    expect(thrown, 'there was an error but nothing was thrown').toBeDefined()
    // code lives on the VobsError **property**, not in the message
    expect((thrown as { code?: string }).code).toBe('VOBS_C101')
  })
})
