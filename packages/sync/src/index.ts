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
      setPending([...pendingChanges.value, normalized])
      if (started && isOnline()) void context.sync().catch(() => undefined)
      return normalized
    },

    removePending(id): boolean {
      ensureActive()
      const next = pendingChanges.value.filter(change => change.id !== id)
      if (next.length === pendingChanges.value.length) return false
      setPending(next)
      return true
    },

    clearPending(): void {
      ensureActive()
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
    for (let index = nextPending.length - 1; index >= 0; index--) {
      const local = nextPending[index]
      if (acknowledged.has(local.id) && !conflictIds.has(local.id)) nextPending.splice(index, 1)
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
    const strategy = options.conflict ?? 'remote-wins'
    if (typeof strategy === 'function') return strategy(local, remote)
    return strategy === 'local-wins' ? 'local' : 'remote'
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

  function persist(): void {
    try {
      storage.set<PersistedState<T>>(storageKey, {
        version: 1,
        cursor: cursor.value,
        lastSyncAt: lastSyncAt.value,
        pending: pendingChanges.value
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
  if (!data || typeof data !== 'object') throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: 服务端响应必须是对象')
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
