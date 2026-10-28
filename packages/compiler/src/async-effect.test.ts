/*
 * `VOBS_C106`: handing an **async function** to effect / lifecycle hooks (real project, pitfall 3, 2026-10-02).
 *
 * Code in an async function before the first await runs synchronously, so calling it inside an effect's tracking scope =
 * the effect itself reading those signals. The typical hit surface is "guard read + state-machine write":
 *
 * ```ts
 * effect(async () => {
 *   if (!entSync.value.syncing) return    // read → the effect subscribes to ent.sync
 *   entSync.set({ syncing: true })         // writes a signal it depends on → infinite re-run
 * })
 * ```
 *
 * ## Deliberately detects only **direct** shapes
 *
 * `effect(async () => …)` is visible from pure syntax (the callback carries the `async` modifier) — zero cost, zero false positives.
 * For the **indirect** shape `effect(() => { void someAsyncFn() })`, the callee's async-ness lives in
 * another module, invisible to a pure AST — detecting it would require a TypeChecker, and Vite's transform
 * is per-file, which would break the architecture. Indirect shapes are left to the runtime guardrails (C210/C211).
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c106 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C106')

describe('VOBS_C106 shapes that must be reported', () => {
  it('`effect(async () => …)`', () => {
    expect(c106(`effect(async () => { await load() })`)).toHaveLength(1)
  })

  it('`onMount(async () => …)`', () => {
    expect(c106(`onMount(async () => { await load() })`)).toHaveLength(1)
  })

  it('an async function expression', () => {
    expect(c106(`effect(async function () { await load() })`)).toHaveLength(1)
  })

  it('`renderEffect` / `memo` / `on` are within the detection surface too', () => {
    for (const api of ['renderEffect', 'memo', 'on']) {
      expect(c106(`${api}(async () => { await load() })`), `${api} was not detected`).toHaveLength(1)
    }
  })

  it('is a warning, not an error (it must not block builds)', () => {
    expect(c106(`effect(async () => { await load() })`)[0]!.severity).toBe('warning')
  })

  it('the fix text offers the three escapes: on() / onMount / untrack', () => {
    const fix = c106(`effect(async () => { await load() })`)[0]!.fix ?? ''
    expect(fix).toContain('on(')
    expect(fix).toContain('onMount')
    expect(fix).toContain('untrack')
  })
})

describe('VOBS_C106 shapes that must not be reported', () => {
  it('a sync callback (indirect calls are invisible — an intentional boundary)', () => {
    expect(c106(`effect(() => { void load() })`)).toEqual([])
  })

  it('`effect(on(deps, () => …))` — exactly the recommended fix', () => {
    expect(c106(`effect(on(session, () => { void load() }))`)).toEqual([])
  })

  it('an explicit untrack wrapper', () => {
    expect(c106(`effect(() => { untrack(() => { void load() }) })`)).toEqual([])
  })

  it('an async callback on a non-tracking API (event callbacks are outside the tracking scope)', () => {
    expect(c106(`handleClick(async () => { await load() })`)).toEqual([])
  })

  it('a tracking API whose first argument is not a callback', () => {
    expect(c106(`effect(someOtherEffect)`)).toEqual([])
  })
})
