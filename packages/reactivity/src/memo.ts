import { cleanupDependencies } from './effect'
import { getCurrentOwner } from './owner'
import { invokeDebug, hasDebugHooks } from './debug'
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
  trackDependency,
  type Dependency,
  type ReadableSignal,
  type Subscriber
} from './signal'

/** Derived value: a read-only signal. Writes are forbidden at the type level; the runtime setter remains as a backstop for callers that bypass type checking. */
export interface Memo<T> extends ReadableSignal<T> {}

/**
 * The memo's dependency-collection identity (acts as currentSubscriber during compute).
 *
 * Kept separate from `MemoSignal` by necessity: one is a signal (subscribable), the
 * other is a subscriber (collects dependencies); they cannot be the same object.
 * **Why a class instead of an object literal here** — see the note on `MemoSignal`.
 */
class MemoSubscriber<T> implements Subscriber {
  readonly dependencies = new Set<Dependency>()
  /** Plain data field instead of `get disposed()`: accessors on a literal drop the instance into dictionary mode. */
  disposed = false

  constructor(private readonly signal: MemoSignal<T>) {}

  notify(): void {
    // Same logic as the original closure implementation: no further propagation once disposed or dirty
    if (this.disposed || this.signal.dirty) return
    this.signal.invalidate()
  }
}

/**
 * Derived-value signal.
 *
 * **Class instead of object literal**: same reason as `StateSignal` in `signal.ts` —
 * get/set accessors on an object literal demote the V8 instance to dictionary mode;
 * measured, each `.value` read went from ~1ns to ~13ns, and memo reads are part of
 * the render hot path.
 */
class MemoSignal<T> implements Memo<T> {
  /** Cached derived value and dirty flag: owned exclusively by this signal (the subscriber accesses them by reference). */
  cached!: T
  dirty = true
  disposed = false
  readonly subscribers = new Set<Subscriber>()
  readonly subscriber: MemoSubscriber<T>
  /**
   * Per-instance arrow function: it must be passable **detached from the object** —
   * `owner?.addCleanup(memoSignal.dispose)` is exactly how it is used; a prototype
   * method would lose `this`.
   */
  readonly dispose: () => void

  constructor(private readonly compute: () => T) {
    this.subscriber = new MemoSubscriber(this)
    this.dispose = () => { this.disposeNow() }
  }

  get value(): T {
    const subscriber = getCurrentSubscriber()
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber)
      trackDependency(this)
    }

    if (this.dirty) {
      const memoSubscriber = this.subscriber
      cleanupDependencies(memoSubscriber)
      const previous = getCurrentSubscriber()
      setCurrentSubscriber(memoSubscriber)
      try {
        this.cached = this.compute()
        this.dirty = false
      } finally {
        setCurrentSubscriber(previous)
      }
    }

    return this.cached
  }

  set value(_: T) {
    throw new Error('memo: cannot assign directly to a derived value')
  }

  unsubscribe(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber)
  }

  /** Called by MemoSubscriber: marks dirty and propagates invalidation downstream. */
  invalidate(): void {
    this.dirty = true
    if (hasDebugHooks()) invokeDebug('memoInvalidated', this as unknown as ReadableSignal<unknown>)
    for (const subscriber of [...this.subscribers]) subscriber.notify()
  }

  private disposeNow(): void {
    if (this.disposed) return
    this.disposed = true
    this.subscriber.disposed = true
    this.subscribers.clear()
    cleanupDependencies(this.subscriber)
    if (hasDebugHooks()) invokeDebug('signalDisposed', this as unknown as ReadableSignal<unknown>)
  }
}

export function memo<T>(compute: () => T): Memo<T> {
  const memoSignal = new MemoSignal(compute)
  const owner = getCurrentOwner()
  owner?.addCleanup(memoSignal.dispose)
  if (hasDebugHooks()) {
    invokeDebug('signalCreated', memoSignal as unknown as ReadableSignal<unknown>, owner)
    invokeDebug('memoCreated', memoSignal as unknown as ReadableSignal<unknown>, memoSignal.subscriber, owner)
  }
  return memoSignal
}
