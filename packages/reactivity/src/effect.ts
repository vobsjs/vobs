import { getCurrentOwner } from './owner'
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

export function effect(callback: EffectCallback): Effect {
  const owner = getCurrentOwner()
  let cleanup: EffectCleanup | undefined
  let dirty = true
  let disposed = false

  const eff: Effect = {
    order: nextEffectOrder++,
    depth: owner?.depth ?? 0,
    dependencies: new Set<Dependency>(),

    get disposed(): boolean {
      return disposed
    },

    notify(): void {
      if (disposed || dirty) return
      dirty = true
      if (hasDebugHooks()) invokeDebug('effectInvalidated', eff)
      scheduler.schedule(eff)
    },

    run(): void {
      if (disposed || !dirty) return
      dirty = false
      const previousCleanup = cleanup
      cleanup = undefined
      let cleanupError: unknown
      if (previousCleanup) {
        try {
          previousCleanup()
        } catch (error) {
          const handled = owner?.handleError(error) ?? false
          if (!handled) cleanupError = error
        }
      }
      cleanupDependencies(eff)

      const previous = getCurrentSubscriber()
      setCurrentSubscriber(eff)
      let thrown: unknown
      let handled = false
      if (hasDebugHooks()) invokeDebug('effectRunStart', eff)
      try {
        const result = owner ? owner.run(callback) : callback()
        cleanup = typeof result === 'function' ? result : undefined
      } catch (error) {
        thrown = error
        handled = owner?.handleError(error) ?? false
        if (!handled) throw error
      } finally {
        setCurrentSubscriber(previous)
        if (hasDebugHooks()) invokeDebug('effectRunEnd', eff, thrown, handled)
      }
      if (cleanupError && !thrown) throw cleanupError
    },

    scheduleLow(): void {
      if (disposed || dirty) return
      dirty = true
      scheduler.scheduleLow(eff)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      dirty = false
      scheduler.remove(eff)
      const previousCleanup = cleanup
      cleanup = undefined
      let cleanupError: unknown
      if (previousCleanup) {
        try {
          previousCleanup()
        } catch (error) {
          const handled = owner?.handleError(error) ?? false
          if (!handled) cleanupError = error
        }
      }
      cleanupDependencies(eff)
      if (hasDebugHooks()) invokeDebug('effectDisposed', eff)
      if (cleanupError) throw cleanupError
    }
  }

  owner?.addCleanup(eff.dispose)
  if (hasDebugHooks()) invokeDebug('effectCreated', eff, owner)
  eff.run()
  return eff
}

export const renderEffect = effect
