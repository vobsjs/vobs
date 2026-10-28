/*
 * `VOBS_C107`: a `return` in the component body reads a signal (run-once freezing).
 *
 * Real project pitfall 4 (2026-10-02): the v2 shell had a "full-screen direct render" special case for `/login`, written as
 * `if (router.currentRoute.value.path === '/login') return <LoginPage />`，
 * the build passed, but after login the jump to /designer showed no shell — the signal was read in the component body, its value frozen at mount.
 *
 * ## Why this rule exists: **three shapes break identically**
 *
 * Confirmed against real compile output: none of the three outputs below contain `insertDynamic` / `createBlock`:
 *
 * ```ts
 * return cond.value ? <A/> : <B/>      // (1) both branches JSX
 * if (cond.value) return <A/> …        // (2) early-return if
 * return cond.value ? <A/> : null      // (3) one side null (C104 also reports this)
 * ```
 *
 * Because there is **no parent/anchor at the component's top-level `return`**, and reactive conditional rendering needs a slot where
 * content can be swapped — the return value **is** the node itself.
 *
 * But C104 only recognizes (3) (its test is empty literals), **tolerating (1) and (2)**, which freeze just the same.
 * That is exactly pitfall 4's shape, and the reason a separate rule is required.
 *
 * ## Key test: **only reads outside JSX** are reported
 *
 * ```ts
 * return cond.value ? <A/> : <B/>              // ❌ frozen
 * return <div>{cond.value ? <A/> : <B/>}</div> // ✅ the child position gets a compiler-generated conditional factory
 * ```
 *
 * They look alike with opposite outcomes. So "stop at JSX" is the core of this rule.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c107 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C107')

describe('VOBS_C107 shapes that must be reported (three frozen shapes + variants)', () => {
  it('(1) root-level ternary, both branches JSX', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : <B/> }`)).toHaveLength(1)
  })

  it('(2) early-return if (C104 cannot catch it, but it freezes all the same)', () => {
    expect(c107(`export function S(){ if (cond.value) return <A/>; return <B/> }`)).toHaveLength(1)
  })

  it('(3) root-level ternary with a null side', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : null }`)).toHaveLength(1)
  })

  it('(4) the `&&` shape', () => {
    expect(c107(`export function S(){ return cond.value && <A/> }`)).toHaveLength(1)
  })

  it("(5) dot-path reads (pitfall 4's actual shape)", () => {
    expect(c107(`export function S(){ return router.currentRoute.value.path === "/x" ? <A/> : <B/> }`))
      .toHaveLength(1)
  })

  it('(6) returning a node inside an `if` branch', () => {
    expect(c107(`export function S(){ if (cond.value) { return <A/> } return <B/> }`)).toHaveLength(1)
  })

  it('a warning, not an error (statics cannot tell "is it a component")', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : <B/> }`)[0]!.severity).toBe('warning')
  })

  it('the fix points to RouterView / Show and states plainly that "hoisting to the top-level return does not work"', () => {
    const fix = c107(`export function S(){ return cond.value ? <A/> : <B/> }`)[0]!.fix ?? ''
    expect(fix).toContain('RouterView')
    expect(fix).toContain('Show')
    // Pitfall 4's workaround was wrong — the text must say so, so nobody believes writing it at the top level works
    expect(fix).toContain('does not work')
  })
})

describe('VOBS_C107 shapes that must not be reported (correct and unrelated shapes)', () => {
  it('**a JSX child position** — the correct form; the compiler generates a conditional factory', () => {
    expect(c107(`export function S(){ return <div>{cond.value ? <A/> : <B/>}</div> }`)).toEqual([])
  })

  it('**a JSX attribute position** — likewise handled by the bound effect', () => {
    expect(c107(`export function S(){ return <div class={cond.value ? "on" : "off"} /> }`)).toEqual([])
  })

  it('returns a node but reads no signal', () => {
    expect(c107(`export function S(){ return <div>static</div> }`)).toEqual([])
  })

  it('reads a signal but returns data, producing no node', () => {
    expect(c107(`export function S(){ return cond.value ? 1 : 2 }`)).toEqual([])
  })

  it('no signal read in the condition (an ordinary variable)', () => {
    expect(c107(`export function S({ on }: P){ return on ? <A/> : <B/> }`)).toEqual([])
  })
})

describe('VOBS_C107 call-site exemption (a named function called only from JSX contexts = evaluation in a reactive scope)', () => {
  it('**called only at a JSX child position** — branch evaluation re-runs with the signals, not frozen (the real groupCards case)', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <div>{groupCards()}</div>
}`)).toEqual([])
  })

  it('**called only at a JSX attribute position** — attributes evaluate through bound effects / getters, likewise reactive', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <Picker items={groupCards()} />
}`)).toEqual([])
  })

  it('**a synchronous call in the component body** — the function body ran once during component-body execution, truly frozen, reported as usual', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  const cards = groupCards()
  return <div>{cards}</div>
}`)).toHaveLength(1)
  })

  it('**a call inside a nested function within JSX** — a function boundary sits between the call site and the JSX, evaluation timing unknown, conservatively reported', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <div>{() => groupCards()}</div>
}`)).toHaveLength(1)
  })

  it('**a call in an effect callback** — also during component-body execution (synchronously up to the first await), reported as usual', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  effect(() => { void groupCards() })
  return <B/>
}`)).toHaveLength(1)
  })

  it('**no call site at all** (the component itself / passed around as a value) — safety unprovable, conservatively reported', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  pass(groupCards)
  return <B/>
}`)).toHaveLength(1)
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <B/>
}`)).toHaveLength(1)
  })

  it('the exemption only applies to named functions — an anonymous host (IIFE) has no name, conservatively reported (the return + if paths report one each)', () => {
    expect(c107(`export function S(){
  return (() => { if (cond.value) return <A/>; return <B/> })()
}`)).toHaveLength(2)
  })
})

describe('VOBS_C107 Case 3: the empty-value guard (absorbed 2026-10-28; the last silent failure in silent-failures)', () => {
  it('`if (signal) return null` + a JSX return in the same function — the component shape is reported as usual', () => {
    const found = c107(`export function S(){
  if (loading.value) return null
  return <div>{content}</div>
}`)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('empty-value guard')
    expect(found[0]!.fix).toContain('down into a JSX')
  })

  it('`return undefined` / `return false` variants also count as empty guards', () => {
    expect(c107(`export function S(){ if (loading.value) return undefined; return <A/> }`)).toHaveLength(1)
    expect(c107(`export function S(){ if (loading.value) return false; return <A/> }`)).toHaveLength(1)
  })

  it('an empty guard in a pure data function is **not reported** — the function-level narrowing (no JSX return = not rendered, freezing is out of the question)', () => {
    expect(c107(`export function S(props){
  const find = (id: string) => { if (id === '') return null; return props.items.find(i => i.id === id) }
  return <div>{find('a')?.name}</div>
}`)).toEqual([])
  })

  it('a guard helper **called only from JSX** — the exemption applies as usual (the null variant of the real groupCards case)', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return null; return <B/> }
  return <div>{groupCards()}</div>
}`)).toEqual([])
  })

  it('a guard helper **called synchronously in the component body** — truly frozen, reported as usual', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return null; return <B/> }
  const cards = groupCards()
  return <div>{cards}</div>
}`)).toHaveLength(1)
  })

  it('a guard helper with **no call site** (cross-file use / the component itself) — safety unprovable, conservatively reported', () => {
    expect(c107(`export function S(){
  if (loading.value) return null
  return <B/>
}`)).toHaveLength(1)
  })
})
