/*
 * `VOBS_C104`: a **bare conditional `return`** at the top level of a component.
 *
 * Why it deserves a compile diagnostic: components are run-once — the function body executes once and `cond` is pinned at mount time,
 * and later signal changes **never** re-run this `return`, so the UI never switches. And it looks
 * **extremely similar** to `{cond ? <A/> : <B/>}` at a JSX child position (a compiler-generated reactive conditional factory),
 * making them very hard to tell apart by eye — in the docs this is the "most hit" rule (totals/preview/progress/selection all hit it).
 *
 * A costlier incident (Labelune release black screen): the `null` branch of `return cond ? <JSX/> : null`
 * was once used as a WeakMap key and threw directly; the app crashed on mount with no crash log.
 * The runtime has been fixed (empty values normalize into an empty comment node), but the **semantics are still wrong** — no switching.
 *
 * Test: report only when "the function body directly returns a ternary and one branch is null/undefined/false";
 * conditions at child positions, both branches being nodes, and nested-function internals must not be reported.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c104 = (source: string): Array<{ code: string; message: string; fix?: string }> =>
  compileWithSourceMap(source, { filename: 'case.tsx' })
    .diagnostics.filter(d => d.code === 'VOBS_C104')

describe('VOBS_C104 top-level conditional return', () => {
  it('`return cond ? <JSX/> : null` is reported, pointing out the null return', () => {
    const found = c104('export const A = (p: { on: boolean }) => {\n  return p.on ? <div>yes</div> : null\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('null')
    expect(found[0]!.message).toContain('run-once')
    expect(found[0]!.fix).toContain('JSX child position')
  })

  it('`return cond && <JSX/>` is reported (the false branch)', () => {
    const found = c104('export const B = (p: { on: boolean }) => {\n  return p.on && <div>yes</div>\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('false')
  })

  it('`return cond ? <A/> : undefined` is reported', () => {
    const found = c104('export const C = (p: { on: boolean }) => {\n  return p.on ? <b>y</b> : undefined\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('undefined')
  })

  it('a condition at a JSX child position must **not** be reported (that is the compiler-generated reactive conditional factory)', () => {
    expect(c104('export const D = (p: { on: boolean }) => {\n  return <div>{p.on ? <b>y</b> : <i>n</i>}</div>\n}')).toEqual([])
  })

  it('both branches being nodes must **not** be reported (semantically still frozen, but outside this empty-value test)', () => {
    expect(c104('export const E = (p: { on: boolean }) => {\n  return p.on ? <b>y</b> : <i>n</i>\n}')).toEqual([])
  })

  it("a return inside a nested function must **not** be reported (not the component body's return)", () => {
    expect(c104('export const F = () => {\n  const pick = (on: boolean) => (on ? 1 : null)\n  return <div>{pick(true)}</div>\n}')).toEqual([])
  })

  it('returning null inside a `.map` callback must **not** be reported (a common legitimate list-item shape)', () => {
    expect(c104('export const G = (p: { xs: number[] }) => {\n  return <ul>{p.xs.map(x => (x > 0 ? <li>{x}</li> : null))}</ul>\n}')).toEqual([])
  })

  it('an unconditional return must **not** be reported', () => {
    expect(c104('export const H = () => {\n  return <div>plain</div>\n}')).toEqual([])
  })

  it("the top-level return's location points at the ternary expression (usable line number)", () => {
    const result = compileWithSourceMap(
      'export const I = (p: { on: boolean }) => {\n  return p.on ? <div>yes</div> : null\n}',
      { filename: 'loc.tsx' }
    )
    const found = result.diagnostics.find(d => d.code === 'VOBS_C104')
    expect(found).toBeTruthy()
    expect(found!.location.line).toBe(2)
    expect(found!.location.file).toBe('loc.tsx')
    /*
     * Since 1.8.1 this is a **warning**, not an error.
     *
     * Reason: this rule's argument depends on "this function is a component" — and static analysis **cannot tell**,
     * (an arrow function returning JSX may be a component or a helper invoked during rendering).
     * Real-project upgrade feedback: about 16 of 18 hits were pure-data-function false positives, and an error blocks builds outright.
     * Even after narrowing (only render nodes), what remains is still heuristic, so it must not carry build-blocking strength —
     * the same treatment as C105. What actually breaks is caught precisely by the runtime guardrails (check:runtime).
     */
    expect(found!.severity).toBe('warning')
  })
})
