// @vitest-environment jsdom
/*
 * `Owner.removeCleanup` — un-register a registered cleanup.
 *
 * Reason to exist: **replace** the cleanup of "the same logical resource" instead of
 * appending a new entry on every rebuild. The typical case is `ref`: when the same
 * ref object is bound to different nodes in sequence, the stale registration would
 * reset the new value to null on dispose (see the comments in runtime/src/ref.ts and
 * ref-cleanup.test.ts).
 *
 * This package was burned once before by "cleanups only grow" (the runtime's event
 * rebinding), so this API's semantics is "really remove it from the array", not
 * mark-as-stale.
 */
import { describe, expect, it } from 'vitest'
import { createOwner } from './owner'

describe('Owner.removeCleanup', () => {
  it('after removal the cleanup no longer runs', () => {
    const owner = createOwner()
    const ran: string[] = []
    const a = () => ran.push('a')
    const b = () => ran.push('b')
    owner.onDispose(a)
    owner.onDispose(b)
    owner.removeCleanup(a)
    owner.dispose()
    expect(ran).toEqual(['b'])
  })

  it('really removed from the array (not marked stale)', () => {
    const owner = createOwner()
    const before = owner.mark().cleanups
    const cleanups = [1, 2, 3].map(n => () => { void n })
    for (const c of cleanups) owner.onDispose(c)
    expect(owner.mark().cleanups - before).toBe(3)
    owner.removeCleanup(cleanups[1]!)
    // the count must drop — if it were only marked stale, it would still be 3
    expect(owner.mark().cleanups - before).toBe(2)
    owner.dispose()
  })

  it('replacement semantics: repeated registration of the same key keeps only the last entry', () => {
    const owner = createOwner()
    const ran: number[] = []
    const slot: { cleanup: (() => void) | null } = { cleanup: null }
    const before = owner.mark().cleanups
    for (let i = 0; i < 50; i++) {
      if (slot.cleanup) owner.removeCleanup(slot.cleanup)
      slot.cleanup = () => ran.push(i)
      owner.onDispose(slot.cleanup)
    }
    // after 50 "rebinds" only 1 slot is still occupied
    expect(owner.mark().cleanups - before).toBe(1)
    owner.dispose()
    expect(ran).toEqual([49])
  })

  it('never-registered / repeated removal / disposed Owner calls are all safe', () => {
    const owner = createOwner()
    const c = () => { /* noop */ }
    expect(() => owner.removeCleanup(c)).not.toThrow()
    owner.onDispose(c)
    owner.removeCleanup(c)
    expect(() => owner.removeCleanup(c)).not.toThrow()
    owner.dispose()
    expect(() => owner.removeCleanup(c)).not.toThrow()
  })

  it('does not affect the execution order of other cleanups (still reverse order)', () => {
    const owner = createOwner()
    const order: number[] = []
    const c1 = () => order.push(1)
    const c2 = () => order.push(2)
    const c3 = () => order.push(3)
    owner.onDispose(c1)
    owner.onDispose(c2)
    owner.onDispose(c3)
    owner.removeCleanup(c2)
    owner.dispose()
    expect(order).toEqual([3, 1])
  })
})
