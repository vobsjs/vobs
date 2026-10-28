import { describe, it, expect, vi } from 'vitest'
import * as reactivity from './index'
import { state, effect, memo, createOwner, batch, scheduler, runWithOwner } from './index'
import type { Signal } from './index'
import { state as stateFromSubpath } from '@vobs/reactivity/state'

describe('reactivity', () => {
  it('only exposes the state creation API', () => {
    expect(reactivity.state).toBeTypeOf('function')
    expect('signal' in reactivity).toBe(false)
  })

  it('supports the state subpath import', () => {
    expect(stateFromSubpath(1).value).toBe(1)
  })

  it('state read and write', () => {
    const count = state(0)
    expect(count.value).toBe(0)
    count.value = 1
    expect(count.value).toBe(1)
  })

  it('set is semantically identical to .value = assignment', async () => {
    const count = state(0)
    const fn = vi.fn(() => { void count.value })
    effect(fn)
    count.set(1)
    await Promise.resolve()
    expect(count.value).toBe(1)
    expect(fn).toHaveBeenCalledTimes(2)

    // Object.is equality short-circuit: identical values do not notify subscribers
    count.set(1)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('set can be passed directly as a detached callback', () => {
    const count = state(0)
    const setCount: (next: number) => void = count.set
    setCount(5)
    expect(count.value).toBe(5)
  })

  it('memo has no set; writing a derived value is rejected at runtime', () => {
    const count = state(0)
    const doubled = memo(() => count.value * 2)
    expect('set' in doubled).toBe(false)
    expect(() => { (doubled as unknown as { value: number }).value = 10 }).toThrow()
  })

  it('supports setting a debug name at creation without affecting state behavior', () => {
    const named = state(0, 'dashboard.lastAction')
    expect(reactivity.getSignalDebugName(named)).toBe('dashboard.lastAction')
    named.value = 1
    expect(named.value).toBe(1)
  })

  it('effect responds to state changes', async () => {
    const count = state(0)
    const fn = vi.fn(() => { void count.value })
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    count.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('effect switches dynamic dependencies', async () => {
    const a = state(0)
    const b = state(0)
    const flag = state(true)
    const fn = vi.fn(() => { void (flag.value ? a.value : b.value) })
    effect(fn)
    flag.value = false
    await Promise.resolve()
    a.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
    b.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('memo evaluates lazily on first read', () => {
    const count = state(0)
    const fn = vi.fn(() => count.value * 2)
    const doubled = memo(fn)
    expect(fn).not.toHaveBeenCalled()
    expect(doubled.value).toBe(0)
    expect(fn).toHaveBeenCalledTimes(1)
    count.value = 1
    expect(doubled.value).toBe(2)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('owner cascading disposal', () => {
    const parent = createOwner()
    let childOwner = createOwner()
    parent.run(() => { childOwner = createOwner() })
    expect(parent.children).toHaveLength(1)
    parent.dispose()
    expect(childOwner.disposed).toBe(true)
  })

  it('effects no longer run after the owner is disposed', async () => {
    const owner = createOwner()
    const count = state(0)
    const callback = vi.fn(() => { void count.value })
    owner.run(() => effect(callback))
    owner.dispose()
    count.value = 1
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('state survives owner disposal: the signal stays writable and subscribable by new effects after the scope is released', async () => {
    // Plan A semantics pinned: signal lifetime = reachability. State created while an
    // event handler runs via owner.run (e.g. store data) must remain valid after the
    // triggering UI scope (e.g. a menu dropdown) is disposed.
    const owner = createOwner()
    let created!: Signal<number>
    owner.run(() => { created = state(1, 'scoped.state') })
    owner.dispose()
    expect(created.value).toBe(1)

    const callback = vi.fn(() => { void created.value })
    effect(callback)
    expect(callback).toHaveBeenCalledTimes(1)
    created.set(7)
    await Promise.resolve()
    expect(created.value).toBe(7)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('writes after an explicit dispose are ignored and warn once (including the debug name)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const count = state(0, 'legacy.count')
      count.dispose()
      count.value = 1
      count.set(2)
      expect(count.value).toBe(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('legacy.count')
    } finally {
      warn.mockRestore()
    }
  })

  it('multiple writes inside a batch flush only once', () => {
    const count = state(0)
    const callback = vi.fn(() => { void count.value })
    effect(callback)
    batch(() => {
      count.value = 1
      count.value = 2
      count.value = 3
    })
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('after a memo is invalidated, effects depending on it are notified', async () => {
    const count = state(1)
    const doubled = memo(() => count.value * 2)
    const values: number[] = []
    effect(() => { values.push(doubled.value) })
    count.value = 2
    await Promise.resolve()
    expect(values).toEqual([2, 4])
  })

  it('cleanups run on effect re-execution and disposal', async () => {
    const count = state(0)
    const owner = createOwner()
    const cleanups: number[] = []
    owner.run(() => effect(() => {
      const value = count.value
      return () => cleanups.push(value)
    }))
    count.value = 1
    await Promise.resolve()
    owner.dispose()
    expect(cleanups).toEqual([0, 1])
  })

  it('cleanup errors are handled at the Owner boundary and do not block the next effect run', async () => {
    const count = state(0)
    const owner = createOwner()
    const errors: unknown[] = []
    owner.onError(error => { errors.push(error) })
    let runs = 0
    owner.run(() => effect(() => {
      const value = count.value
      runs++
      return () => { if (value === 0) throw new Error('cleanup failed') }
    }))
    count.value = 1
    await Promise.resolve()
    expect(runs).toBe(2)
    expect(errors).toHaveLength(1)
    owner.dispose()
  })

  it('the Scheduler isolates a single effect error and keeps running the other effects in the same round', () => {
    const source = state(0)
    const calls: string[] = []
    effect(() => {
      if (source.value === 1) throw new Error('first effect failed')
    })
    effect(() => {
      source.value
      calls.push('second')
    })
    source.value = 1
    expect(() => scheduler.flush()).toThrow('first effect failed')
    expect(calls).toEqual(['second', 'second'])
  })

  it('state objects and arrays use shallow replace-to-update semantics', async () => {
    const model = state({ count: 0 })
    const values: number[] = []
    effect(() => { values.push(model.value.count) })
    model.value.count = 1
    expect(values).toEqual([0])
    model.value = { count: 2 }
    await Promise.resolve()
    expect(values).toEqual([0, 2])
  })

  it('nested effects do not lose outer dependency tracking', async () => {
    const outer = state(0)
    const inner = state(0)
    const callback = vi.fn(() => {
      void outer.value
      effect(() => { void inner.value })
    })
    effect(callback)
    outer.value = 1
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('disposing the Owner removes the effect from the scheduling queue', async () => {
    const count = state(0)
    const owner = createOwner()
    const callback = vi.fn(() => { void count.value })
    owner.run(() => effect(callback))
    count.value = 1
    owner.dispose()
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('an async continuation can explicitly re-enter a captured Owner', async () => {
    const owner = createOwner()
    let observed: ReturnType<typeof createOwner> | null = null
    await Promise.resolve()
    runWithOwner(owner, () => { observed = createOwner() })
    expect(observed).not.toBeNull()
    expect(observed!.parent).toBe(owner)
    owner.dispose()
  })

})
