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
  const status = state<SyncStatus>('idle', 'status')
  const progress = state(0, 'progress')
  const error = state<SyncError | null>(null, 'error')
  const lastSyncAt = state<string | null>(null, 'lastSyncAt')
  const cursor = state<SyncCursor>(null, 'cursor')
  const pendingChanges = state<readonly SyncChange<T>[]>([], 'pendingChanges')
  const pending = state(0, 'pending')
  const listeners: { [K in SyncEventName<T>]: Set<SyncEventListener<T, K>> } = {
    start: new Set(),
    done: new Set(),
    error: new Set(),
    online: new Set(),
    offline: new Set()
  }
  /*
   * Conflicts already resolved in favor of local (key = local change id).
   *
   * As long as the server keeps pushing the same key, every sync round re-runs conflict
   * resolution: pulled stays 0 and a custom resolver gets invoked again each round — but the
   * local change hasn't changed one bit, so the verdict cannot change. This only caches
   * "local wins" verdicts (fingerprint = timestamp): "remote wins" results are discarded anyway
   * (behaviorally equivalent), while caching them would wrongly skip re-resolution when "the
   * server corrected the remote value".
   * It's a cache, not a watermark: not persisted; after a restart it re-resolves once with the
   * same verdict.
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
        throw new SyncError('SYNC_OFFLINE', 'Vobs Sync: currently offline')
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
        const offline = Promise.reject(new SyncError('SYNC_OFFLINE', 'Vobs Sync: currently offline'))
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
        const syncError = toSyncError(reason, 'failed to enqueue the sync task')
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
        const syncError = toSyncError(reason, 'sync failed')
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
        throw new SyncError('INVALID_CHANGE', `Vobs Sync: change ${normalized.id} already exists`)
      }
      /*
       * **Persist to disk first, then update memory**: this is the entire point of "offline first".
       *
       * enqueue/removePending/clearPending used to only call setPending (a pure in-memory signal),
       * while persist() only ran at the end of restore()/runCycle() — so the most common path,
       * "edit offline → close the page", **dropped every unuploaded change** (the README's promise
       * of persistence did not hold). A failed persist throws SYNC_FAILED, and memory still holds
       * the old value at that point, so you never get the half-state where "the caller thinks it
       * failed but memory has it".
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
      // The change was removed by the caller, so its "win verdict" is stale too (otherwise the
      // cache only grows, and reusing the same id+timestamp gets short-circuited)
      localWinsResolved.delete(id)
      return true
    },

    clearPending(): void {
      ensureActive()
      persist([])
      setPending([])
      // No pending changes left at all, so the verdict cache must be cleared too (same as above:
      // grow-only would be unbounded)
      localWinsResolved.clear()
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
      throw toSyncError(reason, 'Vobs Sync: sync transport call failed')
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
     * Drop local changes that were acknowledged.
     *
     * When `response.acknowledged` is given **explicitly**, it is the server's list of "which ids I
     * accepted": as soon as an id appears in it, that change should leave the queue — even if it
     * just won a conflict. The old `&& !conflictIds.has(local.id)` kept such changes in pending
     * forever: the server acknowledged them every round, yet the client re-pushed them verbatim
     * every cycle (pushed stuck ≥1). Conflict resolution only answers "should the remote value
     * override the local value", not "did the server accept it".
     *
     * Conversely, when `acknowledged` is absent the entire `sent` batch is treated as accepted
     * (protocol default). That is an assumption with zero information and must not be used to drop
     * a local change that just won a conflict: keeping it pending (= re-push next round,
     * at-least-once) is the existing contract — see index.test.ts "keeps local-wins changes"
     */
    const explicitAcknowledged = response.acknowledged !== undefined
    for (let index = nextPending.length - 1; index >= 0; index--) {
      const local = nextPending[index]
      if (!acknowledged.has(local.id)) continue
      if (!explicitAcknowledged && conflictIds.has(local.id)) continue
      nextPending.splice(index, 1)
      /*
       * The change left the queue, so its "win verdict" must be cleared with it.
       *
       * The old implementation only deleted in the "remote wins" branch (see resolveConflict), so
       * the local-wins cache grew without bound over a long run; worse, if the caller later
       * resubmitted the same change with the **same id+timestamp**, `resolveConflict` would
       * short-circuit to 'local' and **never call** the custom resolver again.
       */
      localWinsResolved.delete(local.id)
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
      throw new SyncError('SYNC_FAILED', 'Vobs Sync: failed to read local sync state', reason)
    }
    if (saved !== null) {
      if (!saved || saved.version !== 1 || (saved.cursor !== null && typeof saved.cursor !== 'string')
        || (saved.lastSyncAt !== null && typeof saved.lastSyncAt !== 'string')
        || !Array.isArray(saved.pending)) {
        throw new SyncError('SYNC_FAILED', 'Vobs Sync: local sync state has an invalid format')
      }
      cursor.value = saved.cursor
      lastSyncAt.value = saved.lastSyncAt
      setPending(saved.pending.map((change, index) => normalizeChange(change, `restored-${index + 1}`, clock())))
      return
    }
    cursor.value = options.lastSyncTime ?? null
    persist()
  }

  /** Persist to disk. Defaults to writing the current pending (used by runCycle/restore); can also take the "next" pending explicitly. */
  function persist(changes: readonly SyncChange<T>[] = pendingChanges.value): void {
    try {
      storage.set<PersistedState<T>>(storageKey, {
        version: 1,
        cursor: cursor.value,
        lastSyncAt: lastSyncAt.value,
        pending: changes
      })
    } catch (reason) {
      throw new SyncError('SYNC_FAILED', 'Vobs Sync: failed to save local sync state', reason)
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
    if (disposed) throw new SyncError('SYNC_CONTEXT_DISPOSED', 'Vobs Sync: context has been disposed')
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
  if (!sync) throw new SyncError('SYNC_CONTEXT_MISSING', 'Vobs Sync: context not found; install syncPlugin first')
  return sync as SyncContext<T>
}

function validateOptions<T>(options: SyncOptions<T>): void {
  if (!options || typeof options !== 'object' || !options.transport || typeof options.transport.sync !== 'function') {
    throw new SyncError('INVALID_SYNC_OPTIONS', 'Vobs Sync: transport.sync is required')
  }
  if (options.pollInterval !== undefined && (!Number.isFinite(options.pollInterval) || options.pollInterval <= 0)) {
    throw new SyncError('INVALID_SYNC_OPTIONS', 'Vobs Sync: pollInterval must be a positive number')
  }
}

function normalizeChange<T>(change: SyncChangeInput<T>, fallbackId: string, fallbackTimestamp: number): SyncChange<T> {
  if (!change || typeof change !== 'object'
    || typeof change.key !== 'string' || change.key.trim() === ''
    || (change.operation !== 'upsert' && change.operation !== 'delete')) {
    throw new SyncError('INVALID_CHANGE', 'Vobs Sync: change must contain a valid key and operation')
  }
  const id = change.id ?? fallbackId
  const timestamp = change.timestamp ?? fallbackTimestamp
  if (typeof id !== 'string' || id.trim() === '' || !Number.isFinite(timestamp)) {
    throw new SyncError('INVALID_CHANGE', 'Vobs Sync: change id and timestamp are invalid')
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
  // Arrays also satisfy `typeof === 'object'`: the old check let them through and then
  // `candidate.changes === undefined` passed too, so a server response shaped like `[{...}]`
  // **faked success** (status=done, pulled=0).
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: server response must be an object')
  }
  const candidate = data as Partial<SyncResponse<T>>
  if (candidate.cursor !== undefined && candidate.cursor !== null && typeof candidate.cursor !== 'string') {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: response cursor must be a string or null')
  }
  if (candidate.timestamp !== undefined && typeof candidate.timestamp !== 'string' && typeof candidate.timestamp !== 'number') {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: response timestamp is invalid')
  }
  if (candidate.changes !== undefined && !Array.isArray(candidate.changes)) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: response changes must be an array')
  }
  if (candidate.acknowledged !== undefined && (!Array.isArray(candidate.acknowledged)
    || candidate.acknowledged.some(id => typeof id !== 'string'))) {
    throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: response acknowledged must be a string array')
  }
  return candidate as SyncResponse<T>
}

function normalizeTimestamp(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new SyncError('INVALID_RESPONSE', 'Vobs Sync: response timestamp is invalid')
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
