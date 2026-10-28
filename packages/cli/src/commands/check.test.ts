import { describe, expect, it } from 'vitest'
import { analyzeSource, VOBS_C118, VOBS_C120, VOBS_C210, VOBS_C232, VOBS_C233, VOBS_C234, type CheckDiagnostic } from './check'

const codes = (diagnostics: readonly CheckDiagnostic[]): string[] => diagnostics.map(item => item.code)

describe('vobs check · VOBS_C210 effect self-subscription', () => {
  /*
   * **This test originally asserted "the false positive exists"** — it pinned the known
   * limitation and would turn red the day it got fixed. That day came: names
   * **re-declared** inside the effect callback body (scope shadowing) are no longer
   * treated as the outer signal. So the assertion is flipped: **must not report**.
   * Severity has also been restored to error.
   */
  it('same-named local object shadowing **no longer** mis-reports (former known limitation, fixed)', () => {
    const found = analyzeSource(`
      import { state, effect } from '@vobs/vobs'
      export function P() {
        const count = state(0)
        effect(() => {
          const count = { value: 0 }
          count.value = count.value + 1
        })
        return count.value
      }
    `, 'a.tsx')
    expect(codes(found), 'this is a local object, not a signal — C210 must not fire').not.toContain(VOBS_C210)
  })

  /*
   * **Outer-level shadowing**: a same-named local declaration in the **component body**
   * (not the effect body) — previously only the inner scope was handled. The criterion is
   * now "is the initializer a call": non-call initializers (object literals / property
   * access) are **definitely not signals**.
   */
  it('same-named object shadowing in the component body also **must not** report C210 (outer-level shadowing)', () => {
    const found = analyzeSource(`
      import { effect, state } from '@vobs/vobs'
      const count = state(0)
      export function P() {
        const count = { value: 0 }
        effect(() => { count.value = count.value + 1 })
        return <div>x</div>
      }
    `, 'a.tsx')
    expect(codes(found), 'a local object in the component body is equally not a signal').not.toContain(VOBS_C210)
  })

  it('but bindings **produced by calls** are still checked — a custom factory may return signals (guards against over-narrowing)', () => {
    /*
     * Key to the criterion: only "the initializer is not a call" is excluded.
     * Results of factory calls (`createStore()` / `useFoo()`) **may well be signals**
     * → the check must be kept.
     */
    const found = analyzeSource(`
      import { effect, createStore } from '@vobs/vobs'
      const store = createStore({ n: 0 })
      export function P() {
        effect(() => { store.value = store.value + 1 })
        return <div>x</div>
      }
    `, 'a.tsx')
    expect(codes(found), 'factory-call result → keep checking, otherwise custom-store self-subscription gets missed').toContain(VOBS_C210)
  })

  it('a binding from property access is not a signal (`const c = props.count`)', () => {
    const found = analyzeSource(`
      import { effect, state } from '@vobs/vobs'
      const count = state(0)
      export function P(props: { count: { value: number } }) {
        const count = props.count
        effect(() => { count.value = count.value + 1 })
        return <div>x</div>
      }
    `, 'a.tsx')
    expect(codes(found), 'props.count is not a signal').not.toContain(VOBS_C210)
  })

  /*
   * **Measured false positive (from the real project Labelune)**: an **IIFE** in a JSX
   * child position re-runs on every dependency change, so `const x = signal.value` inside
   * it is **not** a run-once snapshot.
   *
   * But `returnsJsx(fn)` mistakes such an IIFE for a "component" → mis-reports C118.
   * This was a corpus blind spot: only the "component body as direct statements" shape
   * had been tested before.
   *
   * When fixing, mind the parentheses too: in `(() => {…})()` the arrow's **parent is a
   * `ParenthesizedExpression`, not a `CallExpression`** — the first version checked one
   * level only and did not catch it.
   */
  it('an IIFE in a JSX child position **must not** report C118', () => {
    const shapes = [
      // ① Parenthesized IIFE (the measured false-positive shape, from the real project Labelune)
      `import { state } from '@vobs/vobs'
       export function P() {
         const n = state(0)
         return <div>{(() => { const shown = n.value + 1; return <b>{shown}</b> })()}</div>
       }`,
      // ② IIFE without parentheses
      `import { state } from '@vobs/vobs'
       export function P() {
         const n = state(0)
         return <div>{(() => { const shown = n.value + 1; return <b>{shown}</b> })()}</div>
       }`
    ]
    for (const source of shapes) {
      expect(codes(analyzeSource(source, 'a.tsx')), 'an IIFE re-runs; it is not a run-once snapshot').not.toContain(VOBS_C118)
    }
  })

  /*
   * **A former known residue, now fixed**: render helpers declared in the component body
   * and **manually called** in JSX:
   *
   * ```tsx
   * const render = () => { const shown = n.value + 1; return <b>{shown}</b> }
   * return <div>{render()}</div>      // re-runs on every evaluation → shown is fresh, code is correct
   * ```
   *
   * It was previously indistinguishable from `export const Page = () => {…}` (a real
   * component). Now the **call site** separates them: a function called from a JSX
   * expression (`{render()}`) is a helper; the compiler never "manually calls" components
   * that way. Matching callee only, not references, preserves the true positives below.
   *
   * (This assertion originally read `toContain(VOBS_C118)` and pinned the residue — it
   * turned red when the fix landed, with the message "flip this assertion".
   * **"Known limitations written as tests" paid off a second time.**)
   */
  it('a helper called from a JSX expression **must not** report C118 (former residue)', () => {
    const found = analyzeSource(`
      import { state } from '@vobs/vobs'
      export function P() {
        const n = state(0)
        const render = (): unknown => { const shown = n.value + 1; return <b>{shown}</b> }
        return <div>{render()}</div>
      }
    `, 'a.tsx')
    expect(codes(found), 'the helper re-runs on every evaluation; it is not a run-once snapshot').not.toContain(VOBS_C118)
  })

  it('but a helper called only at **non-JSX** sites is still checked in component form (do not over-narrow)', () => {
    // Only `{render()}` qualifies as a helper; called from an effect, its re-run semantics
    // cannot be determined, so the original judgment holds (prefer misses over losing true positives)
    const found = analyzeSource(`
      import { state, effect } from '@vobs/vobs'
      export function P() {
        const n = state(0)
        const render = (): unknown => { const shown = n.value + 1; return <b>{shown}</b> }
        effect(() => { void render() })
        return <div>x</div>
      }
    `, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C118)
  })

  it('components **passed by reference** (not called) are still checked — match callee only, not references', () => {
    const found = analyzeSource(`
      import { state } from '@vobs/vobs'
      const Card = () => {
        const n = state(0)
        const shown = n.value + 1
        return <b>{shown}</b>
      }
      export function P() {
        return <RouterView component={Card} />
      }
    `, 'a.tsx')
    expect(codes(found), 'merely referenced, never called → still checked as a component').toContain(VOBS_C118)
  })

  it('but the same pattern inside a **component body** must still report (do not switch off true positives while killing false ones)', () => {
    const found = analyzeSource(`
      import { state } from '@vobs/vobs'
      export function P() {
        const n = state(0)
        const shown = n.value + 1
        return <div>{shown}</div>
      }
    `, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C118)
  })

  it('catches read + write on the same signal', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
  count.value++
})
`, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
    const item = found.find(entry => entry.code === VOBS_C210)!
    /*
     * **error** (restored). The only basis for the original downgrade to warning was the
     * measured false positive "same-named local object shadowing" — that one is fixed:
     * names **re-declared** inside the effect callback body are no longer treated as the
     * outer signal (see the `shadowed` set comment in analyze.ts); adversarial tests went
     * from 6/7 to **7/7**.
     */
    expect(item.severity).toBe('error')
    expect(item.message).toContain('"count"')
    // The copy is **shared** with the runtime guardrail (@vobs/runtime's diagnostic-text):
    // teach the structure first (on()), untrack is the fallback — both keyword present in both places
    expect(item.fix).toContain('on(')
    expect(item.fix).toContain('untrack')
    expect(item.line).toBe(5)
  })

  it('writes wrapped in untrack do not report — exactly the recommended form', () => {
    const found = analyzeSource(`
import { state, effect, untrack } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
  untrack(() => { count.value++ })
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('write-only does not count as self-subscription (e.g. initializing another signal inside an effect)', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const a = state(0)
const b = state(0)
effect(() => {
  b.value = 1
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('reads/writes inside nested functions are not charged to this effect', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0)
effect(() => {
  const bump = () => { count.value++ }
  bump()
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('> .set() also counts as a write', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0)
effect(() => {
  if (count.value < 1) count.set(count.value + 1)
})
`, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
  })
})

describe('vobs check · VOBS_C232 list written into a branch', () => {
  it('a map inside a ternary branch loses keyed reuse', () => {
    const found = analyzeSource(`
export function List(props: { ok: boolean; items: string[] }) {
  return <div>{props.ok ? <span>empty</span> : props.items.map(item => <b key={item}>{item}</b>)}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C232)
    expect(found.find(entry => entry.code === VOBS_C232)?.fix).toContain('**direct**')
  })

  it('the simple map shape on the right of && is routed to insertShow — no longer reports (2026-10-28)', () => {
    const found = analyzeSource(`
export function List(props: { items: string[] }) {
  return <div>{props.items.length > 0 && props.items.map(item => <b key={item}>{item}</b>)}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C232)
  })

  it('a list as a direct child expression does not report — this is the recommended form', () => {
    const found = analyzeSource(`
export function List(props: { items: string[] }) {
  return <ul>{props.items.map(item => <li key={item}>{item}</li>)}</ul>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C232)
  })

  it('a non-list branch does not report', () => {
    const found = analyzeSource(`
export function A(props: { ok: boolean }) {
  return <div>{props.ok ? <span>a</span> : <em>b</em>}</div>
}
`, 'a.tsx')
    expect(codes(found)).toEqual([])
  })
})

describe('vobs check · VOBS_C233 in-place mutation of array signals', () => {
  it('push on an array bound to state — the reference never changes, so subscribers never update', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const list = state([1, 2])
  const add = () => { list.value.push(3) }
  return <button onClick={add}>{list.value.length}</button>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C233)
    const item = found.find(entry => entry.code === VOBS_C233)!
    expect(item.severity).toBe('warning')
    expect(item.message).toContain('"list"')
    expect(item.message).toContain('push()')
    // The fix copy teaches swapping the reference — the same sentence as the AGENTS contract "array updates must swap the reference"
    expect(item.fix).toContain('swap the reference')
    expect(item.fix).toContain('[...list.value')
  })

  it('other mutators like sort / splice count too', () => {
    const shapes = [
      'const rows = state([3, 1]); const f = () => { rows.value.sort() }',
      'const rows = state([1]); const f = () => { rows.value.splice(0, 1) }',
      'const rows = state([1]); const f = () => { rows.value.reverse() }'
    ]
    for (const body of shapes) {
      const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  ${body}
  return <div>{rows.value.length}</div>
}
`, 'a.tsx')
      expect(codes(found), body).toContain(VOBS_C233)
    }
  })

  it('the reference-swapping form does not report — exactly what the fix recommends', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const list = state([1, 2])
  const add = () => { list.value = [...list.value, 3] }
  return <button onClick={add}>{list.value.length}</button>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C233)
  })

  it('push on a plain array (not bound to state) does not report — binding analysis is the foundation of this rule', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const log: number[] = []
export function P() {
  const plain = [1, 2]
  plain.push(3)
  log.push(plain.length)
  const count = state(0)
  return <button onClick={() => { count.value++ }}>{count.value}</button>
}
`, 'a.tsx')
    expect(codes(found), 'a plain array has no signal semantics').not.toContain(VOBS_C233)
  })

  it('same-named local shadowing (including parameters) does not report — conservative direction: prefer misses over false positives', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const list = state([1])
export function P(list: { value: number[] }) {
  list.value.push(9)
  return <div>{list.value.length}</div>
}
`, 'a.tsx')
    expect(codes(found), 'the parameter list is not that signal').not.toContain(VOBS_C233)
  })

  it('an inner same-named non-signal object declaration shadows the outer signal — no report', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const list = state([1])
export function P() {
  const inner = () => {
    const list = { value: [1, 2] }   // plain object, not a signal
    list.value.push(9)
    return list.value.length
  }
  return <div>{inner()}</div>
}
`, 'a.tsx')
    expect(codes(found), 'list inside inner is a plain object').not.toContain(VOBS_C233)
  })

  it('signal declaration and mutation in the same function body — still reports (a signal does not count as shadowing; bug exposed by the first adversarial case)', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const list = state([1])
  list.value.push(2)
  return <div>{list.value.length}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C233)
  })

  it('**array mutation** with a non-value property in the chain still does not report (deep mutators left for later; deep field assignment is covered)', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const model = state({ rows: [1] })
  const f = () => { model.value.rows.push(2) }
  return <button onClick={f}>{model.value.rows.length}</button>
}
`, 'a.tsx')
    expect(codes(found), 'form one only matches top-level <name>.value.<mutator>; deep array mutation is another matter').not.toContain(VOBS_C233)
  })

  it('direct object field assignment (X.value.name = newValue) — same trap as array mutation, still reports', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const user = state({ name: 'a' })
  const rename = () => { user.value.name = 'b' }
  return <button onClick={rename}>{user.value.name}</button>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C233)
    const item = found.find(entry => entry.code === VOBS_C233)!
    expect(item.message).toContain('"user"')
    expect(item.message).toContain('inner field')
    expect(item.fix).toContain('{ ...user.value')
  })

  it('deep field assignment (X.value.a.b = newValue) is recognized along the chain and reports', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const model = state({ a: { b: 1 } })
  const f = () => { model.value.a.b = 2 }
  return <button onClick={f}>{model.value.a.b}</button>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C233)
  })

  it('whole-object reference-swap updates do not report — the form the fix recommends', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const user = state({ name: 'a' })
  const rename = () => { user.value = { ...user.value, name: 'b' } }
  return <button onClick={rename}>{user.value.name}</button>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C233)
  })
})

describe('vobs check · VOBS_C120 state() without a debug name', () => {
  it('single-arg state() reports a warning, with a fix suggesting the variable name directly', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const count = state(0)
  return <div>{count.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C120)
    const item = found.find(entry => entry.code === VOBS_C120)!
    expect(item.severity).toBe('warning')
    expect(item.fix).toContain("state(<initial>, 'count')")
  })

  it('a named second argument does not report', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P() {
  const count = state(0, 'count')
  return <div>{count.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C120)
  })

  it('spread arguments make the count unknowable — prefer misses over false positives', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
export function P(args: unknown[]) {
  const s = state(...args)
  return <div>{s.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C120)
  })

  it('non-variable initialization gets a generic hint (no name guessing)', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const registry = { flag: state(false) }
`, 'a.tsx')
    const item = found.find(entry => entry.code === VOBS_C120)!
    expect(item).toBeDefined()
    expect(item.fix).toContain('usually matching the variable')
  })
})

describe('vobs check · VOBS_C234 implicit severed edge inside on callbacks', () => {
  it('an on callback reads a signal outside deps — no subscription is established inside the untrack scope', () => {
    const found = analyzeSource(`
import { effect, on, state } from '@vobs/vobs'
export function P() {
  const a = state(1, 'a')
  const b = state(2, 'b')
  effect(on([a], () => { console.log(a.value, b.value) }))
  return <div>{b.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C234)
    const item = found.find(entry => entry.code === VOBS_C234)!
    expect(item.message).toContain('"b"')
    expect(item.message).toContain('no subscription is established')
    expect(item.fix).toContain('add it to deps')
  })

  it('present in the deps array does not report', () => {
    const found = analyzeSource(`
import { effect, on, state } from '@vobs/vobs'
export function P() {
  const a = state(1, 'a')
  const b = state(2, 'b')
  effect(on([a, b], () => { console.log(a.value, b.value) }))
  return <div>{b.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C234)
  })

  it('deps as a getter — whatever the function reads is subscribed; the read set is compared as usual', () => {
    const found = analyzeSource(`
import { effect, on, state } from '@vobs/vobs'
export function P() {
  const a = state(1, 'a')
  const b = state(2, 'b')
  effect(on(() => a.value, () => { console.log(a.value, b.value) }))
  return <div>{b.value}</div>
}
`, 'a.tsx')
    expect(codes(found), 'the deps getter only reads a; b in the callback is still outside the subscription set').toContain(VOBS_C234)
    expect(analyzeSource(`
import { effect, on, state } from '@vobs/vobs'
export function P() {
  const a = state(1, 'a')
  const b = state(2, 'b')
  effect(on(() => a.value + b.value, () => { console.log(a.value, b.value) }))
  return <div>{b.value}</div>
}
`, 'a.tsx')).not.toContain(VOBS_C234)
  })

  it('.value reads not bound to state do not count as signals — no report (binding-analysis narrowing)', () => {
    const found = analyzeSource(`
import { effect, on, state } from '@vobs/vobs'
export function P(props: { cfg: { value: string } }) {
  const a = state(1, 'a')
  effect(on([a], () => { console.log(props.cfg.value) }))
  return <div>{a.value}</div>
}
`, 'a.tsx')
    expect(codes(found), 'props.cfg is not a state binding').not.toContain(VOBS_C234)
  })
})

describe('vobs check · VOBS_C118 reading signals in the component body', () => {
  it('a signal read into a const and then used in JSX — the component body runs once', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  const current = props.name.value
  return <div>{current}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C118)
    const item = found.find(entry => entry.code === VOBS_C118)!
    expect(item.severity).toBe('warning')
    expect(item.fix).toContain('memo')
    expect(item.message).toContain('"current"')
  })

  it('reads written directly in JSX expressions do not report', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  return <div>{props.name.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  it('memo derivations do not report — that is the correct form', () => {
    const found = analyzeSource(`
import { memo, type Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  const current = memo(() => props.name.value.toUpperCase())
  return <div>{current.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  it('non-component functions do not report (they do not return JSX)', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function read(signal: Signal<string>) {
  const current = signal.value
  return current.toUpperCase()
}
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  /*
   * Regression: this one used to spray 21 false positives in a real project. The read in
   * `const handler = () => { signal.value }` is **deferred** (happens on click), perfectly
   * fine — the first version's traversal descended into function bodies and reported every
   * event handler as "reads a signal in the component body".
   */
  it('reads inside event handlers do not report — that is a deferred read', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const count = state(0)
export function Panel() {
  const bump = () => { count.value++ }
  const simulateMismatch = () => { const current = count.value; return current + 1 }
  return <button onClick={bump}>{simulateMismatch()}</button>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })
})

describe('vobs check · summary', () => {
  it('a clean file yields no diagnostics', () => {
    const found = analyzeSource(`
import { state, memo } from '@vobs/vobs'
const count = state(0, 'count')
const doubled = memo(() => count.value * 2)
export function Counter() {
  return <button onClick={() => count.value++}>{doubled.value}</button>
}
`, 'a.tsx')
    expect(found).toEqual([])
  })

  it('diagnostics are sorted by position and carry a locatable snippet', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => { count.value++ })
`, 'a.ts')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0]?.snippet).toContain('count.value++')
    const lines = found.map(item => item.line)
    expect([...lines].sort((a, b) => a - b)).toEqual(lines)
  })
})

/*
 * Inline suppression. All the rules are heuristics (name- and shape-based), and some legal
 * code happens to look exactly like the pattern — without an escape hatch users would have
 * to disable the whole rule, which is worse than a false negative.
 */
describe('vobs check · inline suppression', () => {
  const selfSubscribe = (prevLine: string) => `
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
${prevLine}
  count.value++
})
`

  it('// vobs-check-ignore-next-line on the previous line suppresses the next line', () => {
    expect(codes(analyzeSource(selfSubscribe('  // vobs-check-ignore-next-line'), 'a.ts'))).not.toContain(VOBS_C210)
  })

  it('without the comment it still reports', () => {
    expect(codes(analyzeSource(selfSubscribe('  // just an ordinary comment'), 'a.ts'))).toContain(VOBS_C210)
  })

  it('only "the next line" is suppressed; other lines are not let through', () => {
    // Line 5 self-subscribes, line 7 does too: a suppression comment on line 4 should only affect line 5
    const source = `
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
// vobs-check-ignore-next-line
effect(() => { count.value++ })
effect(() => { count.value++ })
`
    const found = analyzeSource(source, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
    expect(found.filter(item => item.code === VOBS_C210).length).toBe(1)
    expect(found.find(item => item.code === VOBS_C210)?.line).toBe(6)
  })
})
