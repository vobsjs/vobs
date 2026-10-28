/*
 * `vite-plugin` must **also report analyzer diagnostics** (`C118`/`C232`/`C210` static rules).
 *
 * ## Shape of the gap
 *
 * "A diagnostic exists but is invisible on a particular channel" appeared three times in
 * one round. The survey (`.artifacts/p7-survey.md`) found the **gap was bidirectional**:
 *
 * - Fixed by me: compiler diagnostics invisible in `vobs check` (`6e3a891`)
 * - **But the reverse also held**: analyzer diagnostics **none at all** reported in
 *   `vite build`/`dev`
 *
 * Consequence: invisible during development; only discovered when someone runs
 * `vobs check` or CI — directly conflicts with "errors must not be silent":
 * **the AI finishes its change, `vite build` passes, but the problem is still there.**
 *
 * The rule implementations were already extracted into `@vobs/compiler` (`analyze.ts`),
 * shared by CLI and vite-plugin, so both channels' verdicts are **necessarily identical**
 * (the same implementation).
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

function runTransform(code: string, id: string, context: object = {}) {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('missing transform hook')
  return transform.call(context as ThisParameterType<typeof transform>, code, id)
}

describe('the vite channel must surface analyzer diagnostics', () => {
  it('reading a signal into a constant inside a component body (VOBS_C118) → reported via this.warn', () => {
    const warn = vi.fn()
    runTransform(
      `import { state } from '@vobs/vobs'
       export function Page() {
         const count = state(0)
         const snapshot = count.value
         return <div>{snapshot}</div>
       }`,
      'src/Page.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn, 'VOBS_C118 was never reported — it is still invisible on the vite channel').toHaveBeenCalled()
    expect(text).toContain('VOBS_C118')
    expect(text, 'should include the location').toContain('src/Page.tsx')
    expect(text, 'should include the fix (errors alone are worthless to an AI)').toContain('Fix:')
  })

  it('**clean files raise no warnings** (otherwise "always warn" would also pass the tests above)', () => {
    const warn = vi.fn()
    runTransform(
      `export function Clean() { return <div>{label.value}</div> }`,
      'src/Clean.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(text, `clean file raised a warning: ${text}`).not.toContain('VOBS_C1')
    expect(text).not.toContain('VOBS_C2')
  })

  it('falls back to console.warn when PluginContext is unavailable (never silent)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      runTransform(
        `import { state } from '@vobs/vobs'
         export function Page() {
           const count = state(0)
           const snapshot = count.value
           return <div>{snapshot}</div>
         }`,
        'src/Page2.tsx',
        {}
      )
      const text = spy.mock.calls.map(call => String(call[0])).join('\n')
      expect(text, 'the analyzer diagnostic went to neither this.warn nor console.warn').toContain('VOBS_C118')
    } finally {
      spy.mockRestore()
    }
  })
})
