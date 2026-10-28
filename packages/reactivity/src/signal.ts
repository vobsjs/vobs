import { getCurrentOwner } from './owner'
import { getSignalDebugName, invokeDebug, hasDebugHooks, setSignalDebugName } from './debug'

export interface Dependency {
  unsubscribe(subscriber: Subscriber): void
}

export interface Subscriber {
  readonly dependencies: Set<Dependency>
  readonly disposed: boolean
  notify(): void
}

/** Read-only signal: the minimal contract for derived values (memo) and read-only context — subscribe and read only. */
export interface ReadableSignal<T> extends Dependency {
  readonly value: T
  dispose(): void
}

/** Writable signal: the return type of state(). `set` is semantically identical to `.value =` assignment. */
export interface Signal<T> extends ReadableSignal<T> {
  value: T
  set(next: T): void
}

let currentSubscriber: Subscriber | null = null

export function getCurrentSubscriber(): Subscriber | null {
  return currentSubscriber
}

export function setCurrentSubscriber(subscriber: Subscriber | null): void {
  currentSubscriber = subscriber
}

/** Suspends dependency tracking while `fn` runs, restoring it afterwards (nesting-safe). */
export function untrack<T>(fn: () => T): T {
  const previous = currentSubscriber
  currentSubscriber = null
  try {
    return fn()
  } finally {
    currentSubscriber = previous
  }
}

export function trackDependency(dependency: Dependency): void {
  if (!currentSubscriber || currentSubscriber.disposed) return
  const added = !currentSubscriber.dependencies.has(dependency)
  currentSubscriber.dependencies.add(dependency)
  if (added && hasDebugHooks()) invokeDebug('dependencyTracked', dependency, currentSubscriber)
}

/**
 * A state signal.
 *
 * **Why a class here instead of an object literal** (measured, same machine, same loop,
 * per `.value` read/write):
 *
 *   get/set accessors on an object literal        83.6 ns
 *   the same two accessors on a class prototype    1.2 ns   ← 70×
 *   class prototype + equality check + branch      3.2 ns   ← vs 81 ns for the literal
 *
 * Reason: **defining accessors on an object literal demotes the instance to
 * dictionary mode in V8**, after which every property access takes the slow path.
 * On the prototype, the instance's hidden class is unaffected.
 *
 * This is the hottest path in the whole framework (every read and every write goes
 * through it) — the same disease as on the Owner side (`get disposed()` in `owner.ts`).
 */
class StateSignal<T> implements Signal<T> {
  private current: T
  private disposed = false
  private warnedAfterDispose = false
  private readonly subscribers = new Set<Subscriber>()
  /**
   * Snapshot of the subscribers used for the previous notification. Notification
   * must snapshot (a subscriber may unsubscribe while it is being notified), but
   * it need not be rebuilt on every write: the subscriber set only changes on
   * add/delete, so any add/delete invalidates it.
   */
  private notifySnapshot: Subscriber[] | null = null
  /**
   * `set` is deliberately a **per-instance arrow function**, not a prototype method.
   *
   * It must be usable directly as a callback detached from the object
   * (`const { set } = signal; onClick = () => set(1)`); a prototype method would
   * lose `this`. This contract is pinned by a test:
   * "set can be passed directly as a detached callback".
   *
   * The cost is one extra closure allocation per signal — not on the read/write
   * hot path — in exchange for keeping this contract intact.
   */
  readonly set: (next: T) => void

  constructor(initialValue: T) {
    this.current = initialValue
    this.set = (next: T) => { this.value = next }
  }

  get value(): T {
    const subscriber = getCurrentSubscriber()
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber)
      this.notifySnapshot = null
      if (hasDebugHooks()) invokeDebug('signalRead', this as unknown as Signal<unknown>, subscriber)
      trackDependency(this)
    }
    return this.current
  }

  set value(nextValue: T) {
    if (this.disposed) {
      // Writes after an explicit dispose are always a programming error: warn at most once per signal to avoid spamming in a loop
      if (!this.warnedAfterDispose) {
        this.warnedAfterDispose = true
        const name = getSignalDebugName(this as unknown as Signal<unknown>)
        console.warn(`[vobs] write to a disposed state${name ? ` "${name}"` : ''}; this write was ignored`)
      }
      return
    }
    if (Object.is(this.current, nextValue)) return
    const previousValue = this.current
    this.current = nextValue
    if (hasDebugHooks()) invokeDebug('signalChanged', this as unknown as Signal<unknown>, previousValue, nextValue)
    if (this.subscribers.size === 0) return
    // Reuse the previous snapshot when the subscriber set is unchanged (invalidated on add/delete)
    const snapshot = this.notifySnapshot ?? (this.notifySnapshot = [...this.subscribers])
    for (const subscriber of snapshot) subscriber.notify()
  }

  unsubscribe(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber)
    this.notifySnapshot = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.subscribers.clear()
    this.notifySnapshot = null
    if (hasDebugHooks()) invokeDebug('signalDisposed', this as unknown as Signal<unknown>)
  }
}

/**
 * Create a reactive state signal.
 *
 * State uses identity (`Object.is`) change detection. Objects and arrays are
 * intentionally shallow: mutating a nested property in place does not notify
 * subscribers; assign a new object/array to `value` to publish the change.
 *
 * Lifetime: a state signal is a plain value — it stays writable for as long
 * as it is reachable and is never disposed automatically. Component-scoped
 * effects that subscribe to it are disposed with their owner (which
 * unsubscribes them), so the subscription graph is still cleaned up; the
 * signal itself survives. This keeps data created inside event handlers
 * (which run under `owner.run`) alive even after the triggering UI scope —
 * e.g. a dropdown menu — is destroyed.
 *
 * The optional debug name is metadata for inspection tools only. It does not
 * affect subscriptions, scheduling, serialization, or the signal contract.
 */
export function state<T>(initialValue: T, debugName?: string): Signal<T> {
  const signalInstance = new StateSignal(initialValue)
  // Signal lifetime = reachability: no owner cleanup registration (when effects are
  // disposed they unsubscribe themselves via unsubscribe, so the subscription graph
  // is still released with the scope). Explicit dispose() is only for callers that
  // want to manually retire a signal. The owner is used solely as attribution info
  // for debug hooks (devtools indexing); it does not affect the lifecycle.
  if (hasDebugHooks()) {
    invokeDebug('signalCreated', signalInstance as unknown as Signal<unknown>, getCurrentOwner())
  }
  if (debugName?.trim()) setSignalDebugName(signalInstance as unknown as Signal<unknown>, debugName.trim())
  return signalInstance
}
