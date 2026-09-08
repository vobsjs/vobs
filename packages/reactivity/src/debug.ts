import type { Effect } from './effect'
import type { Owner } from './owner'
import type { Dependency, Signal, Subscriber } from './signal'

export interface ReactivityDebugHooks {
  ownerCreated?(owner: Owner): void
  ownerNamed?(owner: Owner, name: string): void
  ownerDisposed?(owner: Owner): void
  signalCreated?(signal: Signal<unknown>, owner: Owner | null): void
  signalNamed?(signal: Signal<unknown>, name: string): void
  signalRead?(signal: Signal<unknown>, subscriber: Subscriber): void
  signalChanged?(signal: Signal<unknown>, previousValue: unknown, nextValue: unknown): void
  signalDisposed?(signal: Signal<unknown>): void
  dependencyTracked?(dependency: Dependency, subscriber: Subscriber): void
  dependencyUntracked?(dependency: Dependency, subscriber: Subscriber): void
  effectCreated?(effect: Effect, owner: Owner | null): void
  effectInvalidated?(effect: Effect): void
  effectRunStart?(effect: Effect): void
  effectRunEnd?(effect: Effect, error?: unknown, handled?: boolean): void
  effectDisposed?(effect: Effect): void
  memoCreated?(signal: Signal<unknown>, subscriber: Subscriber, owner: Owner | null): void
  memoInvalidated?(signal: Signal<unknown>): void
  flushStart?(): void
  flushEnd?(): void
}

let activeDebugHooks: ReactivityDebugHooks | null = null
const signalNames = new WeakMap<object, string>()

export function setDebugHooks(hooks: ReactivityDebugHooks | null): ReactivityDebugHooks | null {
  const previous = activeDebugHooks
  activeDebugHooks = hooks
  return previous
}

export function getDebugHooks(): ReactivityDebugHooks | null {
  return activeDebugHooks
}

export function setSignalDebugName(signal: Signal<unknown>, name: string): void {
  signalNames.set(signal, name)
  invokeDebug('signalNamed', signal, name)
}

export function getSignalDebugName(signal: Signal<unknown>): string | undefined {
  return signalNames.get(signal)
}

export function invokeDebug<K extends keyof ReactivityDebugHooks>(
  name: K,
  ...args: Parameters<NonNullable<ReactivityDebugHooks[K]>>
): void {
  const callback = activeDebugHooks?.[name] as ((...values: unknown[]) => void) | undefined
  if (!callback) return
  try {
    callback(...args)
  } catch {
    // Debug tooling must never change application behavior.
  }
}
