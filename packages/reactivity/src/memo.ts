import { cleanupDependencies } from './effect'
import { getCurrentOwner } from './owner'
import { invokeDebug } from './debug'
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
  trackDependency,
  type Dependency,
  type Signal,
  type Subscriber
} from './signal'

export interface Memo<T> extends Signal<T> {}

export function memo<T>(compute: () => T): Memo<T> {
  let cached!: T
  let dirty = true
  let disposed = false
  const subscribers = new Set<Subscriber>()

  const memoSubscriber: Subscriber = {
    dependencies: new Set<Dependency>(),

    get disposed(): boolean {
      return disposed
    },

    notify(): void {
      if (disposed || dirty) return
      dirty = true
      invokeDebug('memoInvalidated', memoSignal as Signal<unknown>)
      for (const subscriber of [...subscribers]) subscriber.notify()
    }
  }

  const memoSignal: Memo<T> = {
    get value(): T {
      const subscriber = getCurrentSubscriber()
      if (subscriber && !subscriber.disposed) {
        subscribers.add(subscriber)
        trackDependency(memoSignal)
      }

      if (dirty) {
        cleanupDependencies(memoSubscriber)
        const previous = getCurrentSubscriber()
        setCurrentSubscriber(memoSubscriber)
        try {
          cached = compute()
          dirty = false
        } finally {
          setCurrentSubscriber(previous)
        }
      }

      return cached
    },

    set value(_: T) {
      throw new Error('memo: 派生值不能直接赋值')
    },

    unsubscribe(subscriber: Subscriber): void {
      subscribers.delete(subscriber)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      subscribers.clear()
      cleanupDependencies(memoSubscriber)
      invokeDebug('signalDisposed', memoSignal as Signal<unknown>)
    }
  }

  const owner = getCurrentOwner()
  owner?.addCleanup(memoSignal.dispose)
  invokeDebug('signalCreated', memoSignal as Signal<unknown>, owner)
  invokeDebug('memoCreated', memoSignal as Signal<unknown>, memoSubscriber, owner)
  return memoSignal
}
