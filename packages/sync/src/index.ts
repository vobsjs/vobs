import { QUEUE_KEY, createTaskQueue, type QueueTask, type TaskQueue } from '@vobs/queue'
import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
import { STORAGE_KEY, createStorage, type StorageContext } from '@vobs/storage'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error' | 'offline'
export type SyncOperation = 'upsert' | 'delete'
export type SyncCursor = string | null

export interface SyncChange<T = unknown> {
  readonly id: string
  readonly key: string
  readonly operation: SyncOperation
  readonly value?: T
  readonly timestamp: number
}

export type SyncChangeInput<T = unknown> = Omit<SyncChange<T>, 'id' | 'timestamp'> & {
  readonly id?: string
  readonly timestamp?: number
}

export type SyncConflictChoice<T = unknown> = 'local' | 'remote' | SyncChange<T>
export type SyncConflictResolver<T = unknown> = (
  local: SyncChange<T>,
  remote: SyncChange<T>
) => SyncConflictChoice<T> | PromiseLike<SyncConflictChoice<T>>

export interface SyncConflictOptions<T = unknown> {
  readonly strategy?: 'local-wins' | 'remote-wins' | SyncConflictResolver<T>
}

export interface SyncRequest<T = unknown> {
  readonly cursor: SyncCursor
  readonly changes: readonly SyncChange<T>[]
}

export interface SyncResponse<T = unknown> {
  readonly cursor?: SyncCursor
  readonly timestamp?: string | number
  readonly changes?: readonly SyncChange<T>[]
  /** IDs accepted by the server. When omitted, all sent changes are treated as accepted. */
  readonly acknowledged?: readonly string[]
}

export interface SyncTransport {
  /**
   * Send a serialized Sync request using the application's chosen transport.
   * The core deliberately does not prescribe fetch, Axios, or a response shape.
   */
  sync(payload: unknown, signal: AbortSignal): unknown | PromiseLike<unknown>
}

export interface SyncResult<T = unknown> {
  readonly timestamp: string
  readonly cursor: SyncCursor
  readonly pushed: number
  readonly pulled: number
  readonly changes: readonly SyncChange<T>[]
}

export interface SyncEventMap<T = unknown> {
  start: void
  done: SyncResult<T>
  error: SyncError
  online: void
  offline: void
}

export type SyncEventName<T = unknown> = keyof SyncEventMap<T>
export type SyncEventListener<T = unknown, K extends SyncEventName<T> = SyncEventName<T>> =
  (value: SyncEventMap<T>[K]) => void

export interface SyncOptions<T = unknown> {
  readonly transport: SyncTransport
  readonly storage?: StorageContext
  readonly queue?: TaskQueue
  readonly incremental?: boolean
  /** Initial cursor used only when storage has no saved cursor. */
  readonly lastSyncTime?: string | null
  readonly storageKey?: string
  readonly idFactory?: () => string
  readonly clock?: () => number
  readonly pollInterval?: number
  readonly conflict?: SyncConflictOptions<T>['strategy']
  /** Apply accepted remote changes to the application data store. */
  readonly onRemote?: (changes: readonly SyncChange<T>[], result: SyncResult<T>) => void | PromiseLike<void>
  /** Customize the body sent to the server. */
  readonly serialize?: (request: SyncRequest<T>) => unknown
  /** Normalize the server response into the Sync protocol. */
  readonly parse?: (data: unknown) => SyncResponse<T>
  readonly onError?: (error: SyncError) => void
}

export interface SyncPluginOptions<T = unknown> extends Omit<SyncOptions<T>, 'storage' | 'queue'> {
  readonly storage?: StorageContext
  readonly queue?: TaskQueue
  readonly sync?: SyncContext<T>
}

export interface SyncContext<T = unknown> {
  readonly status: Signal<SyncStatus>
  readonly progress: Signal<number>
  readonly error: Signal<SyncError | null>
  readonly lastSyncAt: Signal<string | null>
  readonly pending: Signal<number>
  readonly cursor: Signal<SyncCursor>
  readonly pendingChanges: Signal<readonly SyncChange<T>[]>
  start(): Promise<SyncResult<T>>
  stop(): void
  sync(): Promise<SyncResult<T>>
  enqueue(change: SyncChangeInput<T>): SyncChange<T>
  removePending(id: string): boolean
  clearPending(): void
  on<K extends SyncEventName<T>>(event: K, listener: SyncEventListener<T, K>): () => void
  dispose(): void
}

export type SyncErrorCode =
  | 'SYNC_CONTEXT_MISSING'
  | 'SYNC_CONTEXT_DISPOSED'
  | 'SYNC_OFFLINE'
  | 'INVALID_SYNC_OPTIONS'
  | 'INVALID_CHANGE'
  | 'INVALID_RESPONSE'
  | 'SYNC_FAILED'

export class SyncError extends Error {
  readonly code: SyncErrorCode
  readonly cause: unknown

  constructor(code: SyncErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'SyncError'
    this.code = code
    this.cause = cause
  }
}

export const SYNC_KEY: InjectionKey<SyncContext<any>> = createInjectionKey<SyncContext<any>>('vobs.sync')

interface PersistedState<T> {
  readonly version: 1
  readonly cursor: SyncCursor
  readonly lastSyncAt: string | null
  readonly pending: readonly SyncChange<T>[]
}

export function createSync<T = unknown>(options: SyncOptions<T>): SyncContext<T> {
  validateOptions(options)
  const storage = options.storage ?? createStorage({ prefix: 'vobs:sync:' })
  const queue = options.queue ?? createTaskQueue({ concurrency: 1 })
  const ownsStorage = !options.storage
  const ownsQueue = !options.queue
  const storageKey = options.storageKey ?? 'sync:default'
  const incremental = options.incremental ?? true
  const clock = options.clock ?? (() => Date.now())
  const status = state<SyncStatus>('idle')
  const progress = state(0)
  const error = state<SyncError | null>(null)
  const lastSyncAt = state<string | null>(null)
  const cursor = state<SyncCursor>(null)
  const pendingChanges = state<readonly SyncChange<T>[]>([])
  const pending = state(0)
  const listeners: { [K in SyncEventName<T>]: Set<SyncEventListener<T, K>> } = {
    start: new Set(),
    done: new Set(),
    error: new Set(),
    online: new Set(),
    offline: new Set()
  }
  /*
   * 已经判给 local 的冲突（键 = 本地变更 id）。
   *
   * 服务端只要还在重复推同一个 key，每轮 sync 都会重新走一遍冲突判定：pulled 永远 0、
   * 自定义 resolver 每轮被再调一次 —— 但本地这份变更一个字都没变，结论不可能变。
   * 这里只缓存"本地赢"的结论（指纹取 timestamp）：远端赢的结果本就被丢弃、行为等价，
   * 而缓存它会在"服务端修正了远端值"时错误地跳过重新判定。
   * 只是缓存，不是水位：不落盘，重启实例后重新判定一次，结论一致。
   */
  const localWinsResolved = new Map<string, number>()
  let disposed = false
  let started = false
  let sequence = 0
  let active: Promise<SyncResult<T>> | undefined
  let activeTask: QueueTask<SyncResult<T>> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let removeOnlineListener: (() => void) | undefined

  restore()

  const context: SyncContext<T> = {
    status,
    progress,
    error,
    lastSyncAt,
    pending,
    cursor,
    pendingChanges,

    async start(): Promise<SyncResult<T>> {
      ensureActive()
      if (!started) {
        started = true
        attachOnlineListener()
        if (options.pollInterval !== undefined) {
          pollTimer = setInterval(() => { void context.sync().catch(() => undefined) }, options.pollInterval)
        }
      }
      if (!isOnline()) {
        markOffline()
        throw new SyncError('SYNC_OFFLINE', 'Vobs Sync: 当前处于离线状态')
      }
      emit('start', undefined)
      return context.sync()
    },

    stop(): void {
      if (disposed) return
      started = false
      if (pollTimer !== undefined) clearInterval(pollTimer)
      pollTimer = undefined
      removeOnlineListener?.()
      removeOnlineListener = undefined
      activeTask?.cancel()
      activeTask = undefined
      active = undefined
      if (status.value === 'syncing' || status.value === 'offline') status.value = 'idle'
      progress.value = 0
    },

    sync(): Promise<SyncResult<T>> {
      ensureActive()
      if (!isOnline()) {
        markOffline()
        const offline = Promise.reject(new SyncError('SYNC_OFFLINE', 'Vobs Sync: 当前处于离线状态'))
        offline.catch(() => undefined)
        return offline
      }
      if (active) return active
      status.value = 'syncing'
      progress.value = 0
      error.value = null
      let task: QueueTask<SyncResult<T>>
      try {
        task = queue.add(signal => runCycle(signal), {
          id: `sync-${++sequence}`,
          priority: 'normal'
        })
      } catch (reason) {
        const syncError = toSyncError(reason, '同步任务无法入队')
        fail(syncError)
        return Promise.reject(syncError)
      }
      activeTask = task
      active = task.promise.then(result => {
        if (!disposed) {
          status.value = 'done'
          progress.value = 100
          emit('done', result)
        }
        return result
      }).catch(reason => {
        const syncError = toSyncError(reason, '同步失败')
        if (!disposed && !isCancellation(reason)) fail(syncError)
        throw syncError
      }).finally(() => {
        if (activeTask === task) activeTask = undefined
        active = undefined
      })
      active.catch(() => undefined)
      return active
    },

    enqueue(change): SyncChange<T> {
      ensureActive()
      const normalized = normalizeChange(change, options.idFactory?.() ?? `change-${++sequence}`, clock())
      if (pendingChanges.value.some(item => item.id === normalized.id)) {
        throw new SyncError('INVALID_CHANGE', `Vobs Sync: 已存在变更 ${normalized.id}`)
      }
      /*
       * **先落盘再改内存**：这是"离线优先"的全部意义。
       *
       * 原来 enqueue/removePending/clearPending 只调 setPending（纯内存信号），而 persist() 只在
       * restore()/runCycle() 末尾调用 —— 于是"离线编辑 → 关页面"这条最常见的路径会**丢掉全部
       * 未上传变更**（README 承诺的持久化不成立）。落盘失败抛 SYNC_FAILED，且此时内存仍是旧值，
       * 不会出现"调用方以为失败了、内存里却有"的半状态。
       */
      const next = [...pendingChanges.value, normalized]
      persist(next)
      setPending(next)
      if (started && isOnline()) void context.sync().catch(() => undefined)
      return normalized
    },

    removePending(id): boolean {
      ensureActive()
      const next = pendingChanges.value.filter(change => change.id !== id)
      if (next.length === pendingChanges.value.length) return false
      persist(next)
      setPending(next)
      return true
    },

    clearPending(): void {
      ensureActive()
      persist([])
      setPending([])
    },

    on(event, listener): () => void {
      ensureActive()
      const set = listeners[event] as Set<SyncEventListener<T, typeof event>>
      set.add(listener)
      return () => set.delete(listener)
    },

    dispose(): void {
      if (disposed) return
      context.stop()
      disposed = true
      for (const set of Object.values(listeners)) set.clear()
      status.dispose()
      progress.dispose()
      error.dispose()
      lastSyncAt.dispose()
      pending.dispose()
      cursor.dispose()
      pendingChanges.dispose()
      if (ownsQueue) queue.dispose()
      if (ownsStorage) storage.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  async function runCycle(signal: AbortSignal): Promise<SyncResult<T>> {
    ensureActive()
    if (signal.aborted) throw abortError()
    const sent = [...pendingChanges.value]
    progress.value = sent.length > 0 ? 10 : 25
    let response: SyncResponse<T>
    try {
      const request = { cursor: incremental ? cursor.value : null, changes: sent }
      const payload = options.serialize?.(request) ?? request
      const result = await options.transport.sync(payload, signal)
      response = options.parse?.(result) ?? parseResponse(result)
    } catch (reason) {
      if (isAbortError(reason)) throw reason
      throw toSyncError(reason, 'Vobs Sync: 同步 transport 调用失败')
    }
    progress.value = 70
    const remote = (response.changes ?? []).map((change, index) => normalizeChange(change, `remote-${index + 1}`, clock()))
    const acknowledged = new Set(response.acknowledged ?? sent.map(change => change.id))
    const nextPending = [...pendingChanges.value]
    const conflictIds = new Set<string>()
    const accepted: SyncChange<T>[] = []
    for (const incoming of remote) {
      if (acknowledged.has(incoming.id)) continue
      const local = nextPending.find(change => change.key === incoming.key)
      if (!local) {
        accepted.push(incoming)
        continue
      }
      const choice = await resolveConflict(local, incoming)
      if (choice === 'local') {
        conflictIds.add(local.id)
        continue
      }
      const selected = choice === 'remote' ? incoming : normalizeChange(choice, choice.id, choice.timestamp)
      const withoutLocal = nextPending.filter(change => change.id !== local.id)
      nextPending.splice(0, nextPending.length, ...withoutLocal)
      accepted.push(selected)
    }
    /*
     * 摘掉已 ack 的本地变更。
     *
     * `response.acknowledged` **显式**给定时，它是服务端"我收下了哪些 id"的清单：
     * 只要某个 id 出现在里面，这份变更就该离队 —— 哪怕它刚在冲突里胜出。
     * 原来的 `&& !conflictIds.has(local.id)` 让这类变更永远留在 pending：
     * 服务端每轮都确认收下了，客户端却每个周期原样重推（pushed 恒 ≥1）。
     * 冲突判定只回答"远端值要不要覆盖本地值"，不回答"服务端收没收下"。
     *
     * 反过来，`acknowledged` 缺省时整份 sent 都被当作已接受（协议默认），
     * 那是没有信息量的假设，不能用来丢弃一份刚刚判赢的本地变更：此时保持
     * pending（= 下轮重推，at-least-once）是既有契约，见 index.test.ts
     * "保留 local-wins 变更"。
     */
    const explicitAcknowledged = response.acknowledged !== undefined
    for (let index = nextPending.length - 1; index >= 0; index--) {
      const local = nextPending[index]
      if (!acknowledged.has(local.id)) continue
      if (!explicitAcknowledged && conflictIds.has(local.id)) continue
      nextPending.splice(index, 1)
    }
    if (signal.aborted) throw abortError()
    const nextCursor = response.cursor ?? (incremental ? cursor.value : null)
    const timestamp = normalizeTimestamp(response.timestamp ?? clock())
    const result: SyncResult<T> = {
      timestamp,
      cursor: nextCursor,
      pushed: sent.length,
      pulled: accepted.length,
      changes: Object.freeze(accepted)
    }
    if (accepted.length > 0) await options.onRemote?.(result.changes, result)
    setPending(nextPending)
    cursor.value = nextCursor
    lastSyncAt.value = timestamp
    persist()
    progress.value = 95
    return result
  }

  async function resolveConflict(local: SyncChange<T>, remote: SyncChange<T>): Promise<SyncConflictChoice<T>> {
    if (localWinsResolved.get(local.id) === local.timestamp) return 'local'
    const strategy = options.conflict ?? 'remote-wins'
    const choice = typeof strategy === 'function' ? await strategy(local, remote) : strategy === 'local-wins' ? 'local' : 'remote'
    if (choice === 'local') localWinsResolved.set(local.id, local.timestamp)
    else localWinsResolved.delete(local.id)
    return choice
  }

  function restore(): void {
    let saved: PersistedState<T> | null = null
    try { saved = storage.get<PersistedState<T>>(storageKey) } catch (reason) {
      throw new SyncError('SYNC_FAILED', 'Vobs Sync: 无法读取本地同步状态', reason)
    }
    if (saved !== null) {
      if (!saved || saved.version !== 1 || (saved.cursor !== null && typeof saved.cursor !== 'string')
        || (saved.lastSyncAt !== null && typeof saved.lastSyncAt !== 'string')
        || !Array.isArray(saved.pending)) {
        throw new SyncError('SYNC_FAILED', 'Vobs Sync: 本地同步状态格式无效')
      }
      cursor.value = saved.cursor
      lastSyncAt.value = saved.lastSyncAt
      setPending(saved.pending.map((change, index) => normalizeChange(change, `restored-${index + 1}`, clock())))
      return
    }
    cursor.value = options.lastSyncTime ?? null
    persist()
  }

  /** 落盘。默认写当前 pending（runCycle/restore 用），也可显式传入"下一次"的 pending。 */
  function persist(changes: readonly SyncChange<T>[] = pendingChanges.value): void {
    try {
      storage.set<PersistedState<T>>(storageKey, {
        version: 1,
        cursor: cursor.value,
        lastSyncAt: lastSyncAt.value,
        pending: changes
      })
    } catch (reason) {
      throw new SyncError('SYNC_FAILED', 'Vobs Sync: 无法保存本地同步状态', reason)
    }
  }

  function setPending(changes: readonly SyncChange<T>[]): void {
    const next = Object.freeze([...changes])
    pendingChanges.value = next
    pending.value = next.length
  }

  function attachOnlineListener(): void {
    if (typeof window === 'undefined' || removeOnlineListener) return
    const online = (): void => {
      emit('online', undefined)
      void context.sync().catch(() => undefined)
    }
    const offline = (): void => {
      markOffline()
      activeTask?.cancel()
    }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    removeOnlineListener = () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }

  function markOffline(): void {
    status.value = 'offline'
    emit('offline', undefined)
  }

  function fail(syncError: SyncError): void {
    status.value = 'error'
    error.value = syncError
    try { options.onError?.(syncError) } catch { /* observers cannot break sync state */ }
    emit('error', syncError)
  }

  function emit<K extends SyncEventName<T>>(event: K, value: SyncEventMap<T>[K]): void {
    const set = listeners[event] as Set<SyncEventListener<T, K>>
    for (const listener of [...set]) {
      try { listener(value) } catch { /* event observers cannot break synchronization */ }
    }
  }

  function ensureActive(): void {
    if (disposed) throw new SyncError('SYNC_CONTEXT_DISPOSED', 'Vobs Sync: 上下文已销毁')
  }
}

export function syncPlugin<T = unknown>(options: SyncPluginOptions<T>): VobsPlugin {
  return {
    name: '@vobs/sync',
    version: '0.1.0',
    install(context) {
      const ownedSync = options.sync ? undefined : createSync({
        ...options,
        storage: options.storage ?? context.inject(STORAGE_KEY),
        queue: options.queue ?? context.inject(QUEUE_KEY)
      })
      context.provide(SYNC_KEY, options.sync ?? ownedSync!)
      return () => ownedSync?.dispose()
    }
  }
}

export function useSync<T = unknown>(): SyncContext<T> {
  const sync = inject(SYNC_KEY)
  if (!sync) throw new SyncError('SYNC_CONTEXT_MISSING', 'Vobs Sync: 找不到上下文，请安装 syncPlugin')
  return sync as SyncContext<T>
}

function validateOptions<T>(options: SyncOptions<T>): void {
  if (!options || typeof options !== 'object' || !options.transport || typeof options.transport.sync !== 'function') {
    throw new SyncError('INVALID_SYNC_OPTIONS', 'Vobs Sync: 必须提供 transport.sync')
  }
  if (options.pollInterval !== undefined && (!Number.isFinite(options.pollInterval) || options.pollInterval <= 0)) {
    throw new SyncError('INVALID_SYNC_OPTIONS', 'Vobs Sync: pollInterval 必须是正数')
  }
}

function normalizeChange<T>(change: SyncChangeInput<T>, fallbackId: string, fallbackTimestamp: number): SyncChange<T> {
  if (!change || typeof change !== 'object'
    || typeof change.key !== 'string' || change.key.trim() === ''
    || (change.operation !== 'upsert' && change.operation !== 'delete')) {
    throw new SyncError('INVALID_CHANGE', 'Vobs Sync: change 必须包含有效的 key 和 operation')
  }
  const id = change.id ?? fallbackId
  const timestamp = change.timestamp ?? fallbackTimestamp
  if (typeof id !== 'string' || id.trim() === '' || !Number.isFinite(timestamp)) {
    throw new SyncError('INVALID_CHANGE', 'Vobs Sync: change 的 id 和 timestamp 无效')
  }
  return Object.freeze({
    id,
    key: change.key,
    operation: change.operation,
    ...(change.operation === 'upsert' ? { value: change.value } : {}),
    timestamp
  }) as SyncChange<T>
}

function parseResponse<T>(data: unknown): SyncResponse<T> {
  // 数组也是 `typeof === 'object'`：原来放行后 `candidate.changes === undefined` 又过关，
  // 于是服务端返回 `[{...}]` 这种形状会**假成功**（status=done、pulled=0）。
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 服务端响应必须是对象')
  }
  const candidate = data as Partial<SyncResponse<T>>
  if (candidate.cursor !== undefined && candidate.cursor !== null && typeof candidate.cursor !== 'string') {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 响应 cursor 必须是字符串或 null')
  }
  if (candidate.timestamp !== undefined && typeof candidate.timestamp !== 'string' && typeof candidate.timestamp !== 'number') {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 响应 timestamp 无效')
  }
  if (candidate.changes !== undefined && !Array.isArray(candidate.changes)) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 响应 changes 必须是数组')
  }
  if (candidate.acknowledged !== undefined && (!Array.isArray(candidate.acknowledged)
    || candidate.acknowledged.some(id => typeof id !== 'string'))) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 响应 acknowledged 必须是字符串数组')
  }
  return candidate as SyncResponse<T>
}

function normalizeTimestamp(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 响应 timestamp 无效')
  return date.toISOString()
}

function toSyncError(reason: unknown, message: string): SyncError {
  if (reason instanceof SyncError) return reason
  if (reason instanceof Error && reason.cause instanceof SyncError) return reason.cause
  if (reason && typeof reason === 'object' && (reason as { cause?: unknown }).cause instanceof SyncError) {
    return (reason as { cause: SyncError }).cause
  }
  return new SyncError('SYNC_FAILED', message, reason)
}

function isCancellation(reason: unknown): boolean {
  return Boolean(reason) && typeof reason === 'object'
    && ((reason as { code?: unknown }).code === 'QUEUE_TASK_CANCELLED'
      || (reason as { name?: unknown }).name === 'AbortError')
}

function isAbortError(reason: unknown): boolean {
  return Boolean(reason) && typeof reason === 'object' && (reason as { name?: unknown }).name === 'AbortError'
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
