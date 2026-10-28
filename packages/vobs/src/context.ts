import { getCurrentOwner, type Owner } from '@vobs/reactivity'
import type { InjectionKey, ProvideOptions } from './app'

const ownerProviders = new WeakMap<Owner, Map<InjectionKey<unknown>, unknown>>()

export function provide<T>(key: InjectionKey<T>, value: T, options: ProvideOptions = {}): void {
  const owner = getCurrentOwner()
  if (!owner) throw new Error('Vobs: provide must be called inside a component or Owner scope')
  provideToOwner(owner, key, value, options)
}

export function inject<T>(key: InjectionKey<T>): T | undefined
export function inject<T>(key: InjectionKey<T>, fallback: T): T
export function inject<T>(key: InjectionKey<T>, fallback?: T): T | undefined {
  const owner = getCurrentOwner()
  const value = owner ? injectFromOwner(owner, key) : undefined
  return value === undefined ? fallback : value
}

export function injectRequired<T>(key: InjectionKey<T>, description?: string): T {
  const value = inject(key)
  if (value === undefined) {
    throw new Error(`Vobs: required injection not found${description ? ` ${description}` : ''}`)
  }
  return value
}

export function provideToOwner<T>(
  owner: Owner,
  key: InjectionKey<T>,
  value: T,
  options: ProvideOptions = {}
): void {
  let providers = ownerProviders.get(owner)
  if (!providers) {
    providers = new Map<InjectionKey<unknown>, unknown>()
    ownerProviders.set(owner, providers)
    owner.onDispose(() => ownerProviders.delete(owner))
  }
  if (providers.has(key) && !options.override) {
    throw new Error(`Vobs: injection ${String(key)} already exists; pass override: true to replace it`)
  }
  providers.set(key, value)
}

export function injectFromOwner<T>(owner: Owner, key: InjectionKey<T>): T | undefined {
  let current: Owner | null = owner
  while (current) {
    const providers = ownerProviders.get(current)
    if (providers?.has(key)) return providers.get(key) as T
    current = current.parent
  }
  return undefined
}
