/*
 * `VOBS_C108`: JSX stored in a variable (the node is created eagerly).
 *
 * Real project crash, 2026-10-02:
 * ```ts
 * const node = <ElementVarPicker el={pickerElement.value} />   // ← eager creation
 * return open.value ? node : null                              // ← condition comes after creation
 * ```
 * The component is instantiated and its body runs at the very moment of variable assignment; `pickerElement.value` may already be null,
 * so reading `.content` crashes.
 *
 * ## A misconception cleared by testing
 *
 * **Prop expressions are not hoisted by the compiler.** The standard shape
 * `<div>{open.value ? <Picker el={picker.value}/> : null}</div>` compiles to safe output —
 * `createComponent` sits inside the condition and the prop is a getter. The real difference is **the JSX written outside the condition**.
 *
 * ## It closes "discipline-only" forbidden zones
 *
 * Two forbidden zones in the user docs previously had **zero diagnostics** (measured: categories B/C/D were all silent): compilation passes, types pass,
 * and runtime crashes happen occasionally. Especially lethal for LLMs — in React,
 * `const node = <X/>; return cond ? node : null` is **perfectly legal** — the shape models most easily produce.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c108 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C108')

describe('VOBS_C108 shapes that must be reported (the node is created eagerly)', () => {
  it('JSX stored in a component-body variable, then used in a condition (the original crashing shape)', () => {
    expect(c108(`export function P(){ const node = <Picker el={p.value} />; return open.value ? node : null }`))
      .toHaveLength(1)
  })

  it('JSX stored in a data constant (the docs say "SSG serialization will blow up")', () => {
    expect(c108(`export function P(){ const items = [{ icon: <Icon/> }]; return <div>{items.map(i => i.icon)}</div> }`))
      .toHaveLength(1)
  })

  it('a component-body variable used unconditionally', () => {
    expect(c108(`export function P(){ const node = <Picker el={p.value} />; return <div>{node}</div> }`))
      .toHaveLength(1)
  })

  it('a `let` declaration counts too (it may be reassigned conditionally)', () => {
    expect(c108(`export function P(){ let node = <Picker/>; if (open.value) node = <Other/>; return node }`))
      .toHaveLength(1)
  })

  it('inside an async function body is reported too', () => {
    expect(c108(`export async function load(){ const node = <A/>; await tick(); return node }`)).toHaveLength(1)
  })

  it('a warning, not an error ("used once" actually works; the conditional shape is the real crash)', () => {
    expect(c108(`export function P(){ const node = <A/>; return <div>{node}</div> }`)[0]!.severity).toBe('warning')
  })

  it('the fix is **branched by usage site** — corrected through real testing (the first version only said "write it at the usage site")', () => {
    const fix = c108(`export function P(){ const node = <A/>; return <div>{node}</div> }`)[0]!.fix ?? ''
    // (1) The JSX child position is the correct scenario for "write it there"
    expect(fix).toContain('JSX child position')
    // (2) The top-level return **must not** become a ternary — no parent/anchor there; both branches being JSX still freezes
    expect(fix, 'the fix must warn that the top-level return must not become a ternary').toContain('do not turn it into a ternary')
    expect(fix).toContain('C107')
    expect(fix).toContain('Show')
    // (3) A function that returns the node
    expect(fix).toContain('=>')
    // (4) Data constants
    expect(fix, 'the fix should warn against storing nodes in data constants').toContain('data constants')
    // (5) The production-proven better solution: permanent mount + passing the state object + internal null checks
    // ((1) fixes the crash, but every condition flip rebuilds the subtree — another documented pitfall)
    expect(fix, 'the fix is missing "use a permanent mount when there is internal state"').toContain('permanently mounted')
    expect(fix).toContain('null-check')
    expect(fix, 'it should state that (1) costs lost state').toContain('lost state')
  })
})

describe('VOBS_C108 shapes that must not be reported', () => {
  it('**functions returning nodes** — the recommended form (lazy evaluation)', () => {
    expect(c108(`export function P(){ const render = () => <Picker el={p.value} />; return <div>{render()}</div> }`))
      .toEqual([])
  })

  it('**the standard child-position conditional** — the correct form (output measured safe)', () => {
    expect(c108(`export function P(){ return <div>{open.value ? <Picker el={p.value}/> : null}</div> }`))
      .toEqual([])
  })

  it("module-top-level variables are **not its business** (that is VOBS_C105's territory, avoiding two diagnostics for one spot)", () => {
    expect(c108(`export const X = <div>a</div>`)).toEqual([])
  })

  it('ordinary variables inside function bodies', () => {
    expect(c108(`export function P(){ const n = 1; return <div>{n}</div> }`)).toEqual([])
  })

  it('a variable holding a function (even when the function body has JSX)', () => {
    expect(c108(`export function P(){ const render = function () { return <A/> }; return <div>{render()}</div> }`))
      .toEqual([])
  })
})
