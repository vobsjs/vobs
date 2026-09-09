import { getCurrentOwner } from './owner'
import { invokeDebug, hasDebugHooks, setSignalDebugName } from './debug'

export interface Dependency {
  unsubscribe(subscriber: Subscriber): void
}

export interface Subscriber {
  readonly dependencies: Set<Dependency>
  readonly disposed: boolean
  notify(): void
}

/** 只读信号：派生值（memo）与只读上下文的最小契约，只能订阅与读取。 */
export interface ReadableSignal<T> extends Dependency {
  readonly value: T
  dispose(): void
}

/** 可写信号：state() 的返回类型。`set` 与 `.value =` 赋值语义完全一致。 */
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
        if (hasDebugHooks()) invokeDebug('signalRead', signalInstance as Signal<unknown>, subscriber)
        trackDependency(signalInstance)
      }
      return value
    },

    set value(nextValue: T) {
      if (disposed || Object.is(value, nextValue)) return
      const previousValue = value
      value = nextValue
      if (hasDebugHooks()) invokeDebug('signalChanged', signalInstance as Signal<unknown>, previousValue, nextValue)
      for (const subscriber of [...subscribers]) subscriber.notify()
    },

    unsubscribe(subscriber: Subscriber): void {
      subscribers.delete(subscriber)
    },

    // 与 `.value =` 赋值同一条路径：判等短路、debug hook、notify 全部一致。
    // 以闭包实现，可安全地作为回调直接传递（无 this 绑定问题）。
    set(next: T): void {
      signalInstance.value = next
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      subscribers.clear()
      if (hasDebugHooks()) invokeDebug('signalDisposed', signalInstance as Signal<unknown>)
    }
  }

  const owner = getCurrentOwner()
  owner?.addCleanup(signalInstance.dispose)
  if (hasDebugHooks()) invokeDebug('signalCreated', signalInstance as Signal<unknown>, owner)
  if (debugName?.trim()) setSignalDebugName(signalInstance as Signal<unknown>, debugName.trim())
  return signalInstance
}
