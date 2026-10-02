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

/**
 * 一条缓存条目的失败快照。只读：改动它不影响缓存与条目信号。
 */
export interface ResourceFailure {
  readonly key: ResourceKey
  readonly error: Error
}

export interface ResourceClient {
  resource<T>(fetcher: ResourceFetcher<T>): Resource<T>
  resource<T>(options: ResourceOptions<T>): Resource<T>
  invalidate(key: ResourceKey): void
  prefetchAll(): Promise<void>
  /**
   * `prefetchAll()` 之后"这一轮有哪些失败"的聚合只读快照。
   *
   * 语义边界（刻意收窄，避免被当成全局错误总线）：
   * - 只读**当前缓存**（即带 key 且 cache 未关的条目）里 `error` 非空的条目 —— 与 `dehydrate()`
   *   读的是同一批条目，只是 `dehydrate()` 剔除失败项、`errors()` 只取失败项；
   * - 无 key / `cache: false` 的条目不在缓存里，因此**不出现**在清单中（它们的失败由各自的
   *   `resource.error` 暴露，没人可枚举的条目放进来只会越攒越多）；
   * - 是**快照**：每次调用返回新数组，失败重试成功、`mutate`、`hydrate`、`clear()` 之后自然消失；
   * - 不做响应式追踪（不是 Signal），渲染期调用不会因失败变化而重渲染 —— SSR 一次性读取正合适。
   */
  errors(): readonly ResourceFailure[]
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

/**
 * 复位**模块级**默认 client 的缓存（`resource()` 函数式 API 用的那一个）。
 *
 * 为什么必须有这个出口：`defaultClient` 是**进程级**缓存，`resource()` 只导出函数本身、
 * 不导出那个 client，所以此前**没有任何办法**把它清掉。实测探针
 * `.artifacts/probe-audit-resource-1.test.mjs` R1：两次 `resource({key:['me'], staleTime:60_000})`
 * （模拟两个 HTTP 请求）第二次 fetcher 调用次数仍是 **1**，直接拿到上一位用户的数据。
 *
 * 服务端每个请求共用同一个模块实例，所以这条在 SSR 下就是**跨请求数据泄漏**；
 * `@vobs/ssr` 的 `renderToStringAsync` 因此在每次渲染的 `finally` 里调它。
 * 浏览器端也可以用它做「登出/切换用户后清空共享缓存」。
 */
export function resetDefaultResourceClient(): void {
  defaultClient.clear()
}

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
        /*
         * 取消不是失败 —— 不该把 AbortError 写进**共享缓存**。
         *
         * 原来这里在 revision 未变时无条件写 error（下面一行的 onError 倒是用 aborted 挡住了）。
         * 后果跨页面：一次 refetch 中途被取消/dispose，缓存里就留下 { data, error: AbortError }；
         * 同 key 的新页面因为 isFresh（staleTime 还没到）**零请求**就拿到这条错误，
         * 而 boundary 先判 error → 直接渲染错误兜底（实测 fetcher 0 次调用）。
         *
         * promise 仍然 reject：调用方要靠它知道自己被取消了（既有测试就是这么断言的）。
         */
        const aborted = controller.signal.aborted
        if (entry.revision === revision) {
          if (!aborted) {
            entry.error.value = error
            options.onError?.(error, entry.key)
          }
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
    /*
     * prefetchAll() 刻意不抛错（SSR 不该因一个请求失败整页 500），失败落在各条目的 error 上。
     * 但"只持有 client 的调用方"此前无法一次问出失败清单：dehydrate() 跳过失败项，
     * 于是连失败 key 都不可枚举，只能由调用方自己另存一份 key 列表再逐个 get() —— 那份列表
     * 一旦漏了缓存里的 key（响应式 key、插件/路由建的 key）就永远发现不了失败。
     * 这里把同一批缓存条目反过来筛一遍，给出一次性、只读、免序列化的失败视图。
     */
    errors(): readonly ResourceFailure[] {
      const failures: ResourceFailure[] = []
      for (const entry of cache.values()) {
        const error = entry.error.value
        if (error) failures.push({ key: entry.key ?? [], error })
      }
      return failures
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
    /*
     * 只有**普通对象**能可靠地序列化成缓存键。
     *
     * 下面那行按"自有可枚举键"序列化，于是 Map、Set、类实例、以及只有原型的对象
     * （Object.create({...})）全都退化成同一个 `object:{}` —— 不同的 key 命中同一条缓存，
     * 第二个 key 的 fetcher 一次都不会调用，却拿到别人的数据。这比崩溃隐蔽得多。
     *
     * 这个包本来就走严格路线（函数/symbol/循环引用直接抛），所以这里也抛：把"拿错数据"
     * 变成一句能照着改的报错，而不是静默串数据。
     */
    const prototype = Object.getPrototypeOf(object)
    if (prototype !== Object.prototype && prototype !== null) {
      const kind = object instanceof Map ? 'Map'
        : object instanceof Set ? 'Set'
          : (object.constructor?.name || '类实例')
      throw new Error(`resource: key 不能包含 ${kind} —— 只有普通对象、数组、Date、RegExp 能被可靠地`
        + '序列化为缓存键；' + kind + ' 会退化成同一个键，让不同 key 命中同一条缓存（拿到别的数据）。'
        + '请改成普通对象或基本类型（例如 { id: 7 }）。')
    }
    const entries = Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${serialize((object as Record<string, unknown>)[key], stack)}`)
    return `object:{${entries.join(',')}}`
  } finally {
    stack.delete(object)
  }
}
