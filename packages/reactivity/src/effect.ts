import { getCurrentOwner, type Owner } from './owner'
import { invokeDebug, hasDebugHooks } from './debug'
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
  type Dependency,
  type Subscriber
} from './signal'
import { scheduler } from './scheduler'

export interface Effect extends Subscriber {
  readonly order: number
  readonly depth: number
  run(): void
  scheduleLow(): void
  dispose(): void
}

export type EffectCleanup = () => void
export type EffectCallback = () => void | EffectCleanup

let nextEffectOrder = 1

export function cleanupDependencies(subscriber: Subscriber): void {
  for (const dependency of subscriber.dependencies) {
    dependency.unsubscribe(subscriber)
    if (hasDebugHooks()) invokeDebug('dependencyUntracked', dependency, subscriber)
  }
  subscriber.dependencies.clear()
}

/**
 * Effect instance.
 *
 * **Why a class instead of an object literal**: same reason as `StateSignal` in
 * `signal.ts` and `OwnerImpl` in `owner.ts` — putting a `get disposed()` accessor
 * on an object literal demotes the instance to **dictionary mode** in V8, after
 * which every property access on the instance takes the slow path. And `disposed`
 * is read on every `notify()` / `run()` call (every signal write × one read per
 * subscriber).
 *
 * Measured (`.artifacts/verify-harness/bench-effect-shape.ts`, same machine, same run):
 *   object literal + `get disposed()`   1.665 ms / 200k reads
 *   class prototype field               0.147 ms / 200k reads   → **11.3×**
 * This is the **third** time the same disease has been fixed in this package
 * (signal and owner were already fixed); effect was the last one left.
 *
 * `disposed` is a plain data field, not an accessor — the external read
 * `effect.disposed` is unchanged, and nothing inside the package ever assigns to
 * it (state transitions only go through `dispose()`).
 */
class EffectImpl implements Effect {
  readonly order: number
  readonly depth: number
  readonly dependencies = new Set<Dependency>()
  disposed = false
  /** Cleanup returned by the last callback run (executed once before the next run, or on dispose). */
  private cleanup: EffectCleanup | undefined
  private dirty = true
  /**
   * Per-instance arrow function: `owner?.addCleanup(eff.dispose)` requires it to be
   * passable **detached from the object**; a prototype method would lose `this`.
   * Same contract as `StateSignal.set` and `MemoSignal.dispose`.
   */
  readonly dispose: () => void

  constructor(
    private readonly owner: Owner | null,
    private readonly callback: EffectCallback
  ) {
    this.order = nextEffectOrder++
    this.depth = owner?.depth ?? 0
    this.dispose = () => { this.disposeNow() }
  }

  notify(): void {
    if (this.disposed || this.dirty) return
    this.dirty = true
    if (hasDebugHooks()) invokeDebug('effectInvalidated', this)
    scheduler.schedule(this)
  }

  run(): void {
    if (this.disposed || !this.dirty) return
    this.dirty = false
    const previousCleanup = this.cleanup
    this.cleanup = undefined
    let cleanupError: unknown
    if (previousCleanup) {
      try {
        previousCleanup()
      } catch (error) {
        const handled = this.owner?.handleError(error) ?? false
        if (!handled) cleanupError = error
      }
    }
    cleanupDependencies(this)

    const previous = getCurrentSubscriber()
    setCurrentSubscriber(this)
    let thrown: unknown
    let handled = false
    if (hasDebugHooks()) invokeDebug('effectRunStart', this)
    try {
      const result = this.owner ? this.owner.run(this.callback) : this.callback()
      this.cleanup = typeof result === 'function' ? result : undefined
    } catch (error) {
      thrown = error
      handled = this.owner?.handleError(error) ?? false
      if (!handled) throw error
    } finally {
      setCurrentSubscriber(previous)
      if (hasDebugHooks()) invokeDebug('effectRunEnd', this, thrown, handled)
    }
    if (cleanupError && !thrown) throw cleanupError
  }

  scheduleLow(): void {
    if (this.disposed || this.dirty) return
    this.dirty = true
    scheduler.scheduleLow(this)
  }

  private disposeNow(): void {
    if (this.disposed) return
    this.disposed = true
    this.dirty = false
    scheduler.remove(this)
    const previousCleanup = this.cleanup
    this.cleanup = undefined
    let cleanupError: unknown
    if (previousCleanup) {
      try {
        previousCleanup()
      } catch (error) {
        const handled = this.owner?.handleError(error) ?? false
        if (!handled) cleanupError = error
      }
    }
    cleanupDependencies(this)
    if (hasDebugHooks()) invokeDebug('effectDisposed', this)
    if (cleanupError) throw cleanupError
  }
}

export function effect(callback: EffectCallback): Effect {
  const owner = getCurrentOwner()
  const eff = new EffectImpl(owner, callback)
  owner?.addCleanup(eff.dispose)
  if (hasDebugHooks()) invokeDebug('effectCreated', eff, owner)
  eff.run()
  return eff
}

export const renderEffect = effect
