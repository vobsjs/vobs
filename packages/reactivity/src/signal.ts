import { getCurrentOwner } from './owner'
import { invokeDebug, setSignalDebugName } from './debug'

export interface Dependency {
  unsubscribe(subscriber: Subscriber): void
}

export interface Subscriber {
  readonly dependencies: Set<Dependency>
  readonly disposed: boolean
  notify(): void
}

export interface Signal<T> extends Dependency {
  value: T
  dispose(): void
}

let currentSubscriber: Subscriber | null = null

export function getCurrentSubscriber(): Subscriber | null {
  return currentSubscriber
}

export function setCurrentSubscriber(subscriber: Subscriber | null): void {
  currentSubscriber = subscriber
}

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
  if (added) invokeDebug('dependencyTracked', dependency, currentSubscriber)
}

/**
 * Create a reactive state signal.
 *
 * State uses identity (`Object.is`) change detection. Objects and arrays are
 * intentionally shallow: mutating a nested property in place does not notify
 * subscribers; assign a new object/array to `value` to publish the change.
 *
 * The optional debug name is metadata for inspection tools only. It does not
 * affect subscriptions, scheduling, serialization, or the signal contract.
 */
export function state<T>(initialValue: T, debugName?: string): Signal<T> {
  let value = initialValue
  let disposed = false
  const subscribers = new Set<Subscriber>()

  const signalInstance: Signal<T> = {
    get value(): T {
      const subscriber = getCurrentSubscriber()
      if (subscriber && !subscriber.disposed) {
        subscribers.add(subscriber)
        invokeDebug('signalRead', signalInstance as Signal<unknown>, subscriber)
        trackDependency(signalInstance)
      }
      return value
    },

    set value(nextValue: T) {
      if (disposed || Object.is(value, nextValue)) return
      const previousValue = value
      value = nextValue
      invokeDebug('signalChanged', signalInstance as Signal<unknown>, previousValue, nextValue)
      for (const subscriber of [...subscribers]) subscriber.notify()
    },

    unsubscribe(subscriber: Subscriber): void {
      subscribers.delete(subscriber)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      subscribers.clear()
      invokeDebug('signalDisposed', signalInstance as Signal<unknown>)
    }
  }

  const owner = getCurrentOwner()
  owner?.addCleanup(signalInstance.dispose)
  invokeDebug('signalCreated', signalInstance as Signal<unknown>, owner)
  if (debugName?.trim()) setSignalDebugName(signalInstance as Signal<unknown>, debugName.trim())
  return signalInstance
}
