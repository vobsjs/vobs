// @vitest-environment jsdom
/*
 * `on()` — declare effect dependencies explicitly (real-project pitfall #3, 2026-10-02).
 *
 * ## Defect shape being pinned
 *
 * `effect` dependencies are **auto-collected**, and **"the effect merely calls a
 * function" does not mean it has no dependencies**: code in the called function
 * before its **first await** runs synchronously, so every signal it reads/writes
 * is attributed to the effect.
 *
 * ```ts
 * effect(() => { if (session.value) void sync() })
 * //   sync() before its first await: reads entSync.value.syncing (guard) + writes entSync.set(...)
 * //   → the effect subscribes to ent.sync → writing it re-triggers the effect → infinite resync (C210 + C211)
 * ```
 *
 * `untrack` fixes it but relies on people remembering; `on()` makes it
 * **structurally impossible to get wrong**.
 *
 * ## Semantics aligned with SolidJS's `on()`
 *
 * Fires only when the declared dependencies change; reads inside the callback
 * body **establish no subscriptions**.
 */
import { describe, expect, it, vi } from 'vitest'
import { effect, on, scheduler, state, untrack } from './index'

const settle = (): void => { scheduler.flush() }

/** Reproduces the async-then-sync function from pitfall #3: reads + writes the same signal before the first await. */
function makeSyncLikeFn(entSync: ReturnType<typeof state<{ syncing: boolean }>>) {
  const calls: number[] = []
  return {
    calls,
    // async function: code before the first await runs synchronously — exactly the mechanism of the pitfall
    async run(): Promise<void> {
      if (entSync.value.syncing) return      // ← guard read (inside the effect's tracking scope!)
      entSync.value = { syncing: true }      // ← state-machine write (triggers itself)
      calls.push(1)
      await Promise.resolve()
      entSync.value = { syncing: false }     // ← written again after completion
    }
  }
}

describe('on(): calling an async function from an effect no longer self-subscribes', () => {
  it('**a bare effect does subscribe to signals read by the called function** (deterministic reproduction, no loop triggered)', () => {
    /*
     * Deliberately **not async** here: letting the bare effect actually enter the
     * "writes a signal it depends on" loop interleaves with the scheduler's
     * microtasks and hung the test for 57 seconds — a hanging test is worse than
     * no test. So only the **first link** of the mechanism is verified: the effect
     * calls a function, and the signals that function reads become the effect's
     * dependencies. Pitfall #3 is this link + "the function also writes the same signal".
     */
    const noise = state(0)
    function readInsideCalledFunction(): number {
      return noise.value        // ← the read happens inside the called function, but still within the effect's tracking scope
    }

    let runs = 0
    const stop = effect(() => { runs++; void readInsideCalledFunction() })
    settle()
    expect(runs).toBe(1)

    noise.value = 1
    settle()
    expect(
      runs,
      'the effect did not subscribe to the signal read by the called function — the pitfall #3 mechanism would not hold and on() would be unnecessary'
    ).toBe(2)
    stop.dispose()
  })
  it('with on(): writing signals touched by the async function **no longer** triggers the effect', () => {
    const session = state<string | null>('s1')
    const entSync = state({ syncing: false })
    const fn = makeSyncLikeFn(entSync)
    let runs = 0

    const stop = effect(on(session, () => {
      runs++
      if (session.value !== null) void fn.run()
    }))
    settle()
    const afterFirst = runs
    expect(afterFirst, 'the first evaluation of on() should call the callback once').toBe(1)

    // write entSync — a bare effect would re-run because of this; on() only subscribes to session, so it must not re-run
    entSync.value = { syncing: false }
    settle()
    entSync.value = { syncing: true }
    settle()
    expect(
      runs,
      'an entSync change triggered the effect — on() did not run the callback inside an untrack scope'
    ).toBe(afterFirst)

    stop.dispose()
  })

  it('fires **as usual** when the dependency itself changes (on() does not mute everything)', () => {
    const session = state('s1')
    const seen: string[] = []
    const stop = effect(on(session, value => { seen.push(value) }))
    settle()
    session.value = 's2'
    settle()
    session.value = 's3'
    settle()
    expect(seen, 'on() swallowed the dependency change too').toEqual(['s1', 's2', 's3'])
    stop.dispose()
  })

  it('previous is the previous dependency value (undefined on the first run)', () => {
    const count = state(1)
    const pairs: Array<[number, number | undefined]> = []
    const stop = effect(on(count, (value, previous) => { pairs.push([value, previous]) }))
    settle()
    count.value = 2
    settle()
    count.value = 3
    settle()
    expect(pairs).toEqual([[1, undefined], [2, 1], [3, 2]])
    stop.dispose()
  })

  it('with defer: true the first evaluation only records and does not call (Solid\'s semantics)', () => {
    const count = state(1)
    const seen: number[] = []
    const stop = effect(on(count, value => { seen.push(value) }, { defer: true }))
    settle()
    expect(seen, 'defer did not take effect; the callback was called on the first evaluation').toEqual([])
    count.value = 2
    settle()
    expect(seen).toEqual([2])
    stop.dispose()
  })

  it('persistence first-touch guard: with defer, a pre-seeded store entry is not deleted by the first touch\'s null value (Finora pitfall §10 regression)', () => {
    // Scenario: a top-level effect(on) does persistence; on first touch the dependency is still the
    // initial value (null) → without defer the callback immediately runs the removeItem branch,
    // deleting the key saved by the previous session (observed 2026-10-25).
    const store: Record<string, string> = { 'finora.tabs.active': 'ledger-1' }
    const activeTab = state<string | null>(null)
    const stop = effect(on(activeTab, value => {
      if (value === null) delete store['finora.tabs.active']
      else store['finora.tabs.active'] = value
    }, { defer: true }))
    settle()
    // first touch only records without calling → the pre-seeded entry is preserved intact
    expect(store['finora.tabs.active']).toBe('ledger-1')

    activeTab.value = 'ledger-2'
    settle()
    expect(store['finora.tabs.active']).toBe('ledger-2')

    // an explicit change to null still takes the delete branch (a real change, not a first-touch artifact)
    activeTab.value = null
    settle()
    expect(store['finora.tabs.active']).toBeUndefined()
    stop.dispose()
  })

  it('dependency array: any change fires, and the value is an array', () => {
    const a = state(1)
    const b = state(10)
    const seen: number[][] = []
    const stop = effect(on([a, b], values => { seen.push(values as number[]) }))
    settle()
    a.value = 2
    settle()
    b.value = 20
    settle()
    expect(seen).toEqual([[1, 10], [2, 10], [2, 20]])
    stop.dispose()
  })

  it('getter function form: an explicit derived source can be passed', () => {
    const list = state([1, 2, 3])
    const seen: number[] = []
    const stop = effect(on(() => list.value.length, length => { seen.push(length) }))
    settle()
    list.value = [1, 2]
    settle()
    // the length did not change (3 → 2 did change)
    expect(seen).toEqual([3, 2])
    stop.dispose()
  })

  it('reads inside the callback do not subscribe (general value, independent of async)', () => {
    const trigger = state(0)
    const noise = state(0)
    let runs = 0
    const stop = effect(on(trigger, () => {
      runs++
      void noise.value          // a bare effect would subscribe to noise; on() must not
    }))
    settle()
    const afterFirst = runs
    noise.value = 1
    settle()
    noise.value = 2
    settle()
    expect(runs, 'noise got subscribed').toBe(afterFirst)
    trigger.value = 1
    settle()
    expect(runs, 'a trigger change did not fire').toBe(afterFirst + 1)
    stop.dispose()
  })

  it('passing a plain value (not a signal/array/function) → throws and explains the consequence', () => {
    expect(() => effect(on(42 as never, () => undefined)))
      .toThrowError(/signal/u)
  })

  it('the cleanup returned by the callback is passed through (the effect cleanup contract is unchanged)', () => {
    const trigger = state(0)
    const cleaned = vi.fn()
    const stop = effect(on(trigger, () => cleaned))
    settle()
    trigger.value = 1
    settle()
    // the previous cleanup should have been called before the re-run
    expect(cleaned).toHaveBeenCalled()
    stop.dispose()
  })
})

describe('on() vs untrack (not a replacement)', () => {
  it('untrack turns everything off; on() keeps the declared dependencies', () => {
    const dep = state(0)
    let untrackedRuns = 0
    let onRuns = 0

    const stopA = effect(() => { untrack(() => { untrackedRuns++; void dep.value }) })
    const stopB = effect(on(dep, () => { onRuns++ }))
    settle()
    dep.value = 1
    settle()

    expect(untrackedRuns, 'untrack does not even subscribe to the dependency').toBe(1)
    expect(onRuns, 'on() should follow the dependency').toBe(2)
    stopA.dispose(); stopB.dispose()
  })
})
