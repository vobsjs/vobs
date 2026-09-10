﻿import { cleanupDependencies } from './effect'
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

/** 派生值：只读信号。写入在类型层面即被禁止；运行时保留 setter 防线兜底未经类型检查的调用方。 */
export interface Memo<T> extends ReadableSignal<T> {}

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
      if (hasDebugHooks()) invokeDebug('memoInvalidated', memoSignal as ReadableSignal<unknown>)
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
      if (hasDebugHooks()) invokeDebug('signalDisposed', memoSignal as ReadableSignal<unknown>)
    }
  }

  const owner = getCurrentOwner()
  owner?.addCleanup(memoSignal.dispose)
  if (hasDebugHooks()) {
    invokeDebug('signalCreated', memoSignal as ReadableSignal<unknown>, owner)
    invokeDebug('memoCreated', memoSignal as ReadableSignal<unknown>, memoSubscriber, owner)
  }
  return memoSignal
}
