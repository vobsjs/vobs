// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createOwner, effect, memo, state, type Signal } from '@vobs/reactivity'
import { createDevTools } from './index'

let active: ReturnType<typeof createDevTools> | undefined

afterEach(() => {
  active?.dispose()
  active = undefined
})

const BROAD = 3000

/**
 * devtools' dependency graph was originally a single `edges` hash table, full-table-scanned by
 * **every** consumer:
 * - `collectEffectIds` / `collectAffectedSignals`: one scan per visited node → O(V×E);
 * - `effectInfo()`: scanned the whole table for dependencies on every call (4 calls per effect
 *   lifecycle);
 * - `signalInfo()`: scanned the whole table for the subscribers count on every call.
 *
 * Measured on a breadth topology of 1 signal → 3000 memos + 3000 effects (6000 edges), single
 * signal write:
 * **before the fix 581.19 / 586.92 / 598.07 ms → after 25.70 / 18.42 / 20.04 ms (about 31×)**.
 * The bottleneck was "large propagation set", not edge count.
 *
 * ⚠️ Timing requires letting the scheduler settle between rounds: the propagation traversal only
 * runs when "this signal creates a new pending update"; consecutive writes to the same signal
 * reuse the same pending entry, so what you measure would just be the fast path (missing this bug).
 */
describe('@vobs/devtools propagation traversal', () => {
  function buildBroad(owner: ReturnType<typeof createOwner>) {
    let broad!: Signal<number>
    owner.run(() => {
      broad = state(0)
      for (let index = 0; index < BROAD; index++) {
        const derived = memo(() => broad.value + index)
        effect(() => { void derived.value })
      }
    })
    return broad
  }

  it('breadth topology: propagation results stay complete and are no longer O(V×E)', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    const broad = buildBroad(owner)

    // The propagation traversal only runs when "this signal creates a new pending update"
    // (consecutive writes to the same signal reuse the same pending entry), so the scheduler
    // must be allowed to settle between rounds — otherwise you measure the pending-reusing fast path.
    const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }
    const samples: number[] = []
    for (let round = 0; round < 3; round++) {
      await settle()
      const started = performance.now()
      broad.value += 1
      samples.push(performance.now() - started)
    }
    const elapsed = Math.min(...samples)
    await settle()

    // The propagation set must be the complete 3000 effects (the easiest place to break while reindexing)
    const update = active.getUpdates().at(-1)!
    expect(update.affectedEffects).toHaveLength(BROAD)
    expect(active.getDependencies(update.signalId)).toHaveLength(BROAD)
    expect(active.getDependents(update.affectedEffects[0]!)).toHaveLength(1)

    // 581ms before the fix, 18.4ms after: the 100ms cap leaves 5× headroom over the fixed state,
    // giving 5× discrimination power against regressions.
    expect(elapsed).toBeLessThan(100)
    owner.dispose()
  })

  it('chained and diamond propagation stay complete (adjacency indexing does not change semantics)', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    let source!: Signal<number>
    const runs: number[] = []
    owner.run(() => {
      source = state(1)
      const first = memo(() => source.value + 1)
      const second = memo(() => first.value * 2)
      const left = memo(() => second.value + 10)
      const right = memo(() => second.value + 20)
      // diamond: second has two downstreams, finally converging into the same effect
      effect(() => { runs.push(left.value + right.value) })
      // chain: source → first → second → third → effect
      const third = memo(() => second.value + 100)
      effect(() => { runs.push(third.value) })
    })

    source.value = 5
    await Promise.resolve()

    const update = active.getUpdates().at(-1)!
    // both effects must be collected (one via the diamond's left branch, one via the chain)
    expect(update.affectedEffects).toHaveLength(2)
    // the propagated signal set must cover the whole chain (source → first → second → left/right/third)
    expect(update.affectedSignals.length).toBeGreaterThanOrEqual(5)
    expect(runs.length).toBeGreaterThanOrEqual(4)
    owner.dispose()
  })
})
