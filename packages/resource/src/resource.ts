import { createOwner, effect, getCurrentOwner, state, type Signal } from '@vobs/reactivity'

export type ResourceKey = readonly unknown[]
export type ResourceKeySource = ResourceKey | Signal<ResourceKey> | (() => ResourceKey)
export type ResourceFetcher<T> = (signal: AbortSignal) => T | PromiseLike<T>
export type ResourceCacheStrategy = 'cache-first' | 'stale-while-revalidate'

export interface Resource<T> {
  readonly key: ResourceKey | undefined
  readonly data: Signal<T | null>
  readonly error: Signal<Error | null>
  readonly loading: Signal<boolean>
  dispose(): void
  refetch(): Promise<T>
  prefetch(): Promise<T>
  invalidate(): void
  mutate(next: T | ((current: T | null) => T)): void
  optimistic<Result>(
    next: T | ((current: T | null) => T),
    action: () => Result | PromiseLike<Result>
  ): Promise<Result>
}

export interface ResourceOptions<T> {
  key?: ResourceKeySource
  fetcher: ResourceFetcher<T>
  staleTime?: number
  cache?: boolean
  strategy?: ResourceCacheStrategy
  retry?: number
  retryDelay?: RetryDelay
}

export type RetryDelay = number | ((attempt: number, error: Error) => number)

export interface ResourceSnapshot<T> {
  readonly data: T | null
  readonly error: Error | null
  readonly loading: boolean
  readonly updatedAt: number
}

export interface ResourceDehydratedEntry {
  readonly key: ResourceKey
  readonly data: unknown
  readonly updatedAt: number
  readonly staleTime: number
}

export interface ResourceDehydratedState {
  readonly version: 1
  readonly entries: readonly ResourceDehydratedEntry[]
}

export interface ResourceClientOptions {
  staleTime?: number
  retry?: number
  retryDelay?: RetryDelay
  onError?: (error: Error, key: ResourceKey | undefined) => void
}

export interface ResourceClient {
  resource<T>(fetcher: ResourceFetcher<T>): Resource<T>
  resource<T>(options: ResourceOptions<T>): Resource<T>
  invalidate(key: ResourceKey): void
  prefetchAll(): Promise<void>
  dehydrate(): ResourceDehydratedState
  hydrate(snapshot: unknown): void
  get<T>(key: ResourceKey): ResourceSnapshot<T> | undefined
  clear(): void
}

interface ResourceEntry<T> {
  readonly key: ResourceKey | undefined
  readonly data: Signal<T | null>
  readonly error: Signal<Error | null>
  readonly loading: Signal<boolean>
  readonly staleTime: number
  readonly subscribers: Set<object>
  updatedAt: number
  revision: number
  inFlight: Promise<T> | null
  controller: AbortController | null
}

const defaultClient = createResourceClient()

export function resource<T>(fetcher: ResourceFetcher<T>): Resource<T>
export function resource<T>(options: ResourceOptions<T>): Resource<T>
export function resource<T>(
  optionsOrFetcher: ResourceOptions<T> | ResourceFetcher<T>
): Resource<T> {
  return typeof optionsOrFetcher === 'function'
    ? defaultClient.resource(optionsOrFetcher)
    : defaultClient.resource(optionsOrFetcher)
}

export function createResourceClient(options: ResourceClientOptions = {}): ResourceClient {
  let owner = createOwner()
  const cache = new Map<string, ResourceEntry<unknown>>()
  const entries = new Set<ResourceEntry<unknown>>()
  const defaultStaleTime = validateStaleTime(options.staleTime ?? 0)
  const defaultRetry = validateRetry(options.retry ?? 0)
  const defaultRetryDelay = options.retryDelay ?? 0

  function createEntry<T>(key: ResourceKey | undefined, staleTime: number): ResourceEntry<T> {
    const entry: ResourceEntry<T> = owner.run(() => ({
      key,
      data: state<T | null>(null),
      error: state<Error | null>(null),
      loading: state(false),
      staleTime,
      subscribers: new Set(),
      updatedAt: 0,
      revision: 0,
      inFlight: null,
      controller: null
    }))
    owner.onDispose(() => entry.controller?.abort())
    entries.add(entry as ResourceEntry<unknown>)
    return entry
  }

  function execute<T>(
    entry: ResourceEntry<T>,
    fetcher: ResourceFetcher<T>,
    retry: number,
    retryDelay: RetryDelay
  ): Promise<T> {
    if (entry.inFlight) return entry.inFlight

    entry.loading.value = true
    entry.error.value = null
    const controller = new AbortController()
    entry.controller = controller
    const revision = entry.revision
    const request = requestWithRetry(fetcher, controller.signal, retry, retryDelay)
    entry.inFlight = request.then(
      data => {
        // 请求飞行期间 mutate/optimistic 已推进 revision 时，迟到的旧结果不得覆盖新数据。
        if (entry.revision === revision) {
          entry.revision++
          entry.data.value = data
          entry.error.value = null
          entry.updatedAt = Date.now()
        }
        return data
      },
      reason => {
        const error = toError(reason)
        if (entry.revision === revision) {
          entry.error.value = error
          if (!controller.signal.aborted) options.onError?.(error, entry.key)
        }
        throw error
      }
    ).finally(() => {
      entry.loading.value = false
      if (entry.controller === controller) entry.controller = null
      entry.inFlight = null
    })
    return entry.inFlight
  }

  function isFresh(entry: ResourceEntry<unknown>): boolean {
    return entry.updatedAt > 0 && Date.now() - entry.updatedAt <= entry.staleTime
  }

  function createResource<T>(
    optionsOrFetcher: ResourceOptions<T> | ResourceFetcher<T>
  ): Resource<T> {
    const config = normalizeOptions(optionsOrFetcher, defaultStaleTime, defaultRetry, defaultRetryDelay)
    if (isReactiveKey(config.key)) return createReactiveResource(config)
    const staticKey = resolveKey(config.key)
    const keyId = config.cache && staticKey ? stableSerialize(staticKey) : undefined
    let entry = keyId ? cache.get(keyId) as ResourceEntry<T> | undefined : undefined
    if (!entry) {
      entry = createEntry(staticKey, config.staleTime)
      if (keyId) cache.set(keyId, entry as ResourceEntry<unknown>)
    }

    const request = (force: boolean): Promise<T> => {
      if (entry.inFlight) return entry.inFlight
      if (!force && config.strategy === 'stale-while-revalidate' && entry.data.value !== null) {
        if (!isFresh(entry)) void execute(entry, config.fetcher, config.retry, config.retryDelay).catch(() => undefined)
        return Promise.resolve(entry.data.value as T)
      }
      if (!force && isFresh(entry as ResourceEntry<unknown>)) return Promise.resolve(entry.data.value as T)
      return execute(entry, config.fetcher, config.retry, config.retryDelay)
    }

    // Initial failures are represented by error and must not become unhandled rejections.
    void request(false).catch(() => undefined)

    const resourceHandle = {}
    entry.subscribers.add(resourceHandle)
    const dispose = (): void => {
      if (!entry?.subscribers.delete(resourceHandle)) return
      if (entry.subscribers.size === 0) entry.controller?.abort()
    }
    getCurrentOwner()?.onDispose(dispose)

    return {
      key: staticKey,
      data: entry.data,
      error: entry.error,
      loading: entry.loading,
      dispose,
      refetch: () => request(true),
      prefetch: () => request(false),
      invalidate: () => { entry.updatedAt = 0 },
      mutate(next) {
        const value = typeof next === 'function'
          ? (next as (current: T | null) => T)(entry.data.value)
          : next
        entry.revision++
        entry.data.value = value
        entry.error.value = null
        entry.updatedAt = Date.now()
      },
      optimistic<Result>(
        next: T | ((current: T | null) => T),
        action: () => Result | PromiseLike<Result>
      ): Promise<Result> {
        const previous = {
          data: entry.data.value,
          error: entry.error.value,
          updatedAt: entry.updatedAt
        }
        const value = typeof next === 'function'
          ? (next as (current: T | null) => T)(entry.data.value)
          : next
        const revision = ++entry.revision
        entry.data.value = value
        entry.error.value = null
        entry.updatedAt = Date.now()

        let actionResult: Promise<Result>
        try {
          actionResult = Promise.resolve(action())
        } catch (reason) {
          actionResult = Promise.reject(reason)
        }
        return actionResult.catch(reason => {
          const error = toError(reason)
          if (entry.revision === revision) {
            entry.revision++
            entry.data.value = previous.data
            entry.error.value = error
            entry.updatedAt = previous.updatedAt
            options.onError?.(error, entry.key)
          }
          throw error
        })
      }
    }

    function createReactiveResource(
      reactiveConfig: ReturnType<typeof normalizeOptions<T>>
    ): Resource<T> {
      const data = state<T | null>(null)
      const error = state<Error | null>(null)
      const loading = state(false)
      const handle = {}
      let activeEntry: ResourceEntry<T> | undefined
      let activeKey: ResourceKey | undefined
      let disposed = false

      const sync = (): void => {
        if (!activeEntry) return
        data.value = activeEntry.data.value
        error.value = activeEntry.error.value
        loading.value = activeEntry.loading.value
      }

      const switchKey = (nextKey: ResourceKey): void => {
        const keyId = reactiveConfig.cache ? stableSerialize(nextKey) : undefined
        let nextEntry = keyId ? cache.get(keyId) as ResourceEntry<T> | undefined : undefined
        if (!nextEntry) {
          nextEntry = createEntry(nextKey, reactiveConfig.staleTime)
          if (keyId) cache.set(keyId, nextEntry as ResourceEntry<unknown>)
        }
        if (activeEntry === nextEntry) {
          sync()
          return
        }
        if (activeEntry) {
          activeEntry.subscribers.delete(handle)
          if (activeEntry.subscribers.size === 0) activeEntry.controller?.abort()
        }
        activeEntry = nextEntry
        activeKey = nextKey
        activeEntry.subscribers.add(handle)
        sync()
        void request(false).catch(() => undefined)
      }

      const stop = effect(() => {
        if (disposed) return
        const nextKey = resolveKey(reactiveConfig.key)
        if (!nextKey) throw new Error('resource: 响应式 key 不能是 undefined')
        switchKey(nextKey)
        sync()
      })

      const dispose = (): void => {
        if (disposed) return
        disposed = true
        stop.dispose()
        if (activeEntry) {
          activeEntry.subscribers.delete(handle)
          if (activeEntry.subscribers.size === 0) activeEntry.controller?.abort()
        }
        activeEntry = undefined
      }
      getCurrentOwner()?.onDispose(dispose)

      return {
        get key(): ResourceKey | undefined { return activeKey },
        data,
        error,
        loading,
        dispose,
        refetch: () => request(true),
        prefetch: () => request(false),
        invalidate: () => { if (activeEntry) activeEntry.updatedAt = 0 },
        mutate(next) {
          if (!activeEntry) return
          const value = typeof next === 'function'
            ? (next as (current: T | null) => T)(activeEntry.data.value)
            : next
          activeEntry.revision++
          activeEntry.data.value = value
          activeEntry.error.value = null
          activeEntry.updatedAt = Date.now()
        },
        optimistic<Result>(
          next: T | ((current: T | null) => T),
          action: () => Result | PromiseLike<Result>
        ): Promise<Result> {
          if (!activeEntry) return Promise.reject(new Error('resource: key 尚未初始化'))
          return createOptimistic<Result>(activeEntry, next, action)
        }
      }

      function request(force: boolean): Promise<T> {
        if (!activeEntry) return Promise.reject(new Error('resource: key 尚未初始化'))
        if (!force && isFresh(activeEntry) && reactiveConfig.strategy === 'cache-first') {
          return Promise.resolve(activeEntry.data.value as T)
        }
        if (!force && reactiveConfig.strategy === 'stale-while-revalidate'
          && activeEntry.data.value !== null) {
          if (!isFresh(activeEntry)) void execute(activeEntry, reactiveConfig.fetcher, reactiveConfig.retry, reactiveConfig.retryDelay)
            .catch(() => undefined)
          return Promise.resolve(activeEntry.data.value as T)
        }
        return execute(activeEntry, reactiveConfig.fetcher, reactiveConfig.retry, reactiveConfig.retryDelay)
      }
    }

    function createOptimistic<Result>(
      target: ResourceEntry<T>,
      next: T | ((current: T | null) => T),
      action: () => Result | PromiseLike<Result>
    ): Promise<Result> {
      const previous = { data: target.data.value, error: target.error.value, updatedAt: target.updatedAt }
      const value = typeof next === 'function'
        ? (next as (current: T | null) => T)(target.data.value)
        : next
      const revision = ++target.revision
      target.data.value = value
      target.error.value = null
      target.updatedAt = Date.now()
      return Promise.resolve().then(action).catch(reason => {
        const failure = toError(reason)
        if (target.revision === revision) {
          target.revision++
          target.data.value = previous.data
          target.error.value = failure
          target.updatedAt = previous.updatedAt
          options.onError?.(failure, target.key)
        }
        throw failure
      })
    }
  }

  return {
    resource: createResource,
    invalidate(key) {
      const entry = cache.get(stableSerialize(key))
      if (entry) entry.updatedAt = 0
    },
    async prefetchAll() {
      const requests = [...entries]
        .map(entry => entry.inFlight)
        .filter((request): request is Promise<unknown> => request !== null)
      await Promise.allSettled(requests)
    },
    dehydrate() {
      const entries: ResourceDehydratedEntry[] = []
      for (const entry of cache.values()) {
        if (entry.updatedAt <= 0 || entry.error.value) continue
        entries.push({
          key: entry.key ?? [],
          data: entry.data.value,
          updatedAt: entry.updatedAt,
          staleTime: entry.staleTime
        })
      }
      return { version: 1, entries }
    },
    hydrate(snapshot) {
      for (const restored of parseDehydratedState(snapshot).entries) {
        const keyId = stableSerialize(restored.key)
        const entry = cache.get(keyId) as ResourceEntry<unknown> | undefined
          ?? createEntry(restored.key, restored.staleTime)
        entry.data.value = restored.data
        entry.error.value = null
        entry.loading.value = false
        entry.updatedAt = restored.updatedAt
        entry.revision++
        cache.set(keyId, entry)
      }
    },
    get<T>(key: ResourceKey): ResourceSnapshot<T> | undefined {
      const entry = cache.get(stableSerialize(key)) as ResourceEntry<T> | undefined
      if (!entry) return undefined
      return {
        data: entry.data.value,
        error: entry.error.value,
        loading: entry.loading.value,
        updatedAt: entry.updatedAt
      }
    },
    clear() {
      cache.clear()
      entries.clear()
      owner.dispose()
      owner = createOwner()
    }
  }
}

function normalizeOptions<T>(
  optionsOrFetcher: ResourceOptions<T> | ResourceFetcher<T>,
  defaultStaleTime: number,
  defaultRetry: number,
  defaultRetryDelay: RetryDelay
): Required<Pick<ResourceOptions<T>, 'fetcher' | 'staleTime' | 'cache' | 'strategy' | 'retry' | 'retryDelay'>> & Pick<ResourceOptions<T>, 'key'> {
  if (typeof optionsOrFetcher === 'function') {
    return {
      fetcher: optionsOrFetcher,
      staleTime: defaultStaleTime,
      cache: false,
      strategy: 'cache-first',
      retry: defaultRetry,
      retryDelay: defaultRetryDelay
    }
  }
  return {
    key: optionsOrFetcher.key,
    fetcher: optionsOrFetcher.fetcher,
    staleTime: validateStaleTime(optionsOrFetcher.staleTime ?? defaultStaleTime),
    cache: optionsOrFetcher.cache ?? Boolean(optionsOrFetcher.key),
    strategy: optionsOrFetcher.strategy ?? 'cache-first',
    retry: validateRetry(optionsOrFetcher.retry ?? defaultRetry),
    retryDelay: optionsOrFetcher.retryDelay ?? defaultRetryDelay
  }
}

function isReactiveKey(key: ResourceKeySource | undefined): key is Signal<ResourceKey> | (() => ResourceKey) {
  return typeof key === 'function' || isSignal(key)
}

function isSignal(value: unknown): value is Signal<ResourceKey> {
  return value !== null && typeof value === 'object' && 'value' in value
    && typeof (value as { dispose?: unknown }).dispose === 'function'
}

function resolveKey(source: ResourceKeySource | undefined): ResourceKey | undefined {
  const key = typeof source === 'function'
    ? source()
    : isSignal(source) ? source.value : source
  if (key === undefined) return undefined
  if (!Array.isArray(key)) throw new Error('resource: key 必须是数组')
  return key
}

function requestWithRetry<T>(
  fetcher: ResourceFetcher<T>,
  signal: AbortSignal,
  retry: number,
  retryDelay: RetryDelay
): Promise<T> {
  let attempt = 0
  const request = (): Promise<T> => Promise.resolve().then(() => fetcher(signal)).catch(reason => {
    const error = toError(reason)
    if (signal.aborted) throw error
    if (attempt++ >= retry) throw error
    const delay = resolveRetryDelay(retryDelay, attempt, error)
    return delay > 0 ? wait(delay).then(request) : request()
  })
  return request()
}

function resolveRetryDelay(retryDelay: RetryDelay, attempt: number, error: Error): number {
  const delay = typeof retryDelay === 'function' ? retryDelay(attempt, error) : retryDelay
  if (!Number.isFinite(delay) || delay < 0) {
    throw new Error('resource: retryDelay 必须是大于等于 0 的有限数字')
  }
  return delay
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay))
}

function validateStaleTime(staleTime: number): number {
  if (!Number.isFinite(staleTime) || staleTime < 0) {
    throw new Error('resource: staleTime 必须是大于等于 0 的有限数字')
  }
  return staleTime
}

function validateRetry(retry: number): number {
  if (!Number.isInteger(retry) || retry < 0) {
    throw new Error('resource: retry 必须是大于等于 0 的整数')
  }
  return retry
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

export function stableSerialize(value: unknown): string {
  return serialize(value, new Set<object>())
}

export function serializeResourceState(snapshot: ResourceDehydratedState): string {
  const serialized = JSON.stringify(snapshot)
  return serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function parseDehydratedState(snapshot: unknown): ResourceDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('resource: 预取状态不是有效 JSON')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('resource: 预取状态格式无效')
  const candidate = value as { version?: unknown; entries?: unknown }
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error('resource: 预取状态版本或 entries 无效')
  }

  const entries: ResourceDehydratedEntry[] = []
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('resource: 预取条目格式无效')
    const candidateEntry = entry as Partial<ResourceDehydratedEntry>
    if (!Array.isArray(candidateEntry.key)
      || typeof candidateEntry.updatedAt !== 'number'
      || !Number.isFinite(candidateEntry.updatedAt)
      || typeof candidateEntry.staleTime !== 'number'
      || !Number.isFinite(candidateEntry.staleTime)
      || candidateEntry.staleTime < 0) {
      throw new Error('resource: 预取条目字段无效')
    }
    // Re-serialize now so untrusted keys cannot poison the cache map.
    stableSerialize(candidateEntry.key)
    entries.push({
      key: candidateEntry.key,
      data: candidateEntry.data,
      updatedAt: candidateEntry.updatedAt,
      staleTime: candidateEntry.staleTime
    })
  }
  return { version: 1, entries }
}

function serialize(value: unknown, stack: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return `string:${JSON.stringify(value)}`
    case 'boolean': return `boolean:${value}`
    case 'number':
      if (Number.isNaN(value)) return 'number:NaN'
      if (Object.is(value, -0)) return 'number:-0'
      return `number:${value}`
    case 'bigint': return `bigint:${value}`
    case 'undefined': return 'undefined'
    case 'function':
    case 'symbol':
      throw new Error(`resource: key 不能包含 ${typeof value}`)
    case 'object': break
  }

  const object = value as object
  if (stack.has(object)) throw new Error('resource: key 不能包含循环引用')
  stack.add(object)
  try {
    if (Array.isArray(object)) {
      return `array:[${object.map(item => serialize(item, stack)).join(',')}]`
    }
    if (object instanceof Date) return `date:${object.toJSON()}`
    if (object instanceof RegExp) return `regexp:${object.toString()}`
    const entries = Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${serialize((object as Record<string, unknown>)[key], stack)}`)
    return `object:{${entries.join(',')}}`
  } finally {
    stack.delete(object)
  }
}
