import { getCurrentOwner, onDispose } from '@vobs/reactivity'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type StorageType = 'local' | 'session' | 'memory'
export type StorageKind = StorageType | 'custom'

export interface StorageLike {
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
}

export type StorageMigration = (
  value: unknown,
  fromVersion: number,
  toVersion: number
) => unknown

export interface StorageOptions {
  readonly storage?: StorageLike | StorageType
  readonly fallback?: StorageLike
  readonly prefix?: string
  readonly version?: number
  readonly migrate?: StorageMigration
  readonly onError?: (error: StorageError) => void
}

export interface StorageChange {
  readonly key: string
  readonly value: unknown | null
  readonly source: 'local' | 'external'
}

export interface StorageContext {
  readonly kind: StorageKind
  readonly persistent: boolean
  readonly prefix: string
  readonly version: number
  get<T>(key: string): T | null
  set<T>(key: string, value: T): void
  remove(key: string): void
  clear(): void
  has(key: string): boolean
  keys(): readonly string[]
  subscribe(listener: (change: StorageChange) => void): () => void
  dispose(): void
}

export type StorageErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'CORRUPT_DATA'
  | 'SERIALIZATION_FAILED'
  | 'MIGRATION_FAILED'

export class StorageError extends Error {
  readonly code: StorageErrorCode
  readonly key: string | undefined
  readonly cause: unknown

  constructor(code: StorageErrorCode, message: string, key?: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.code = code
    this.key = key
    this.cause = cause
  }
}

export const STORAGE_KEY: InjectionKey<StorageContext> = createInjectionKey<StorageContext>('vobs.storage')

export interface StoragePluginOptions extends StorageOptions {
  readonly context?: StorageContext
}

interface Envelope {
  readonly __vobsStorage: true
  readonly version: number
  /** Optional because JSON drops undefined/function/Symbol values, so this key disappears. */
  readonly value?: unknown
}

export function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    get length(): number {
      return values.size
    },
    getItem(key): string | null {
      return values.get(key) ?? null
    },
    setItem(key, value): void {
      values.set(key, value)
    },
    removeItem(key): void {
      values.delete(key)
    },
    key(index): string | null {
      return [...values.keys()][index] ?? null
    }
  }
}

export const memoryStorage = createMemoryStorage()

export function createStorage(options: StorageOptions = {}): StorageContext {
  const prefix = options.prefix ?? 'vobs:'
  const version = validateVersion(options.version ?? 1)
  const fallback = options.fallback ?? createMemoryStorage()
  const selected = resolveStorage(options.storage)
  let backend = selected.backend ?? fallback
  let kind: StorageKind = selected.kind
  let disposed = false
  let stopBrowserListener: (() => void) | undefined
  const listeners = new Set<(change: StorageChange) => void>()

  const context: StorageContext = {
    get kind(): StorageKind {
      return kind
    },

    get persistent(): boolean {
      return kind !== 'memory'
    },

    prefix,
    version,

    get<T>(key: string): T | null {
      ensureActive()
      const normalizedKey = validateKey(key)
      const raw = read(normalizedKey)
      if (raw === null) return null
      return decode<T>(normalizedKey, raw, true)
    },

    set<T>(key: string, value: T): void {
      ensureActive()
      const normalizedKey = validateKey(key)
      let raw: string
      try {
        raw = JSON.stringify({ __vobsStorage: true, version, value } satisfies Envelope)
      } catch (error) {
        const storageError = new StorageError(
          'SERIALIZATION_FAILED',
          `Vobs Storage: failed to serialize key ${normalizedKey}`,
          normalizedKey,
          error
        )
        report(storageError)
        throw storageError
      }
      write(normalizedKey, raw)
      emit({ key: normalizedKey, value, source: 'local' })
    },

    remove(key: string): void {
      ensureActive()
      const normalizedKey = validateKey(key)
      withBackend(normalizedKey, () => backend.removeItem(toPhysicalKey(normalizedKey)))
      emit({ key: normalizedKey, value: null, source: 'local' })
    },

    clear(): void {
      ensureActive()
      const physicalKeys = listPhysicalKeys()
      for (const physicalKey of physicalKeys) {
        withBackend(physicalKey, () => backend.removeItem(physicalKey))
      }
      for (const physicalKey of physicalKeys) {
        emit({ key: physicalKey.slice(prefix.length), value: null, source: 'local' })
      }
    },

    has(key: string): boolean {
      return context.get(key) !== null
    },

    keys(): readonly string[] {
      ensureActive()
      return listPhysicalKeys().map(key => key.slice(prefix.length))
    },

    subscribe(listener): () => void {
      ensureActive()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      stopBrowserListener?.()
      stopBrowserListener = undefined
      listeners.clear()
    }
  }

  if (selected.browserStorage && typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent): void => {
      if (event.storageArea && event.storageArea !== backend) return
      if (!event.key || !event.key.startsWith(prefix)) return
      const key = event.key.slice(prefix.length)
      emit({ key, value: event.newValue === null ? null : decodeExternal(key, event.newValue), source: 'external' })
    }
    window.addEventListener('storage', onStorage)
    stopBrowserListener = () => window.removeEventListener('storage', onStorage)
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function read(key: string): string | null {
    return withBackend(key, () => backend.getItem(toPhysicalKey(key)))
  }

  function write(key: string, value: string): void {
    withBackend(key, () => backend.setItem(toPhysicalKey(key), value))
  }

  /**
   * `persist` is only true on the **read path** (`get`): after migration the key is upgraded to the
   * current version and written back to disk, which is the existing contract
   * (README: "reads of older data run through migrate and are persisted back").
   * The external-event path passes `false`; see `decodeExternal` for why.
   */
  function decode<T>(key: string, raw: string, persist: boolean): T | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      handleCorrupt(key, error)
      return null
    }

    const envelope = isEnvelope(parsed) ? parsed : { version: 0, value: parsed }
    if (envelope.version >= version || !options.migrate) return (envelope.value ?? null) as T | null

    try {
      const migrated = options.migrate(envelope.value, envelope.version, version)
      if (persist) {
        write(key, JSON.stringify({ __vobsStorage: true, version, value: migrated } satisfies Envelope))
      }
      return migrated as T | null
    } catch (error) {
      const storageError = new StorageError(
        'MIGRATION_FAILED',
        `Vobs Storage: failed to migrate key ${key}`,
        key,
        error
      )
      report(storageError)
      return null
    }
  }

  /**
   * `newValue` arrives from another tab's write: parse the envelope and run the **same** migration,
   * handing subscribers the value at the current version.
   *
   * This used to only do JSON.parse + unwrap (not reusing `decode`), so the same old data appeared
   * in two shapes: the external event handed subscribers `{old:1}` while `get('k')` on this page
   * returned `{migrated:{old:1}}` — same key, same context, but the structure subscribers received
   * diverged from reads; and subscribers typically won't (and shouldn't) call `get()` again just
   * because an event arrived, so "versioned envelope + migrate" simply broke on the cross-tab path.
   *
   * Deliberately does **not** write back to storage, unlike the read path:
   *   ① The event path is a **notification**, not a read; writing back would be the "write side
   *      effect on the read path" called out in the report.
   *   ② Writing the same key inside a storage event handler triggers another storage event on the
   *      **other tabs**, so two tabs writing to each other forms a cross-tab write storm / feedback
   *      loop (and burns quota for nothing).
   * The old envelope stays on disk; the next real `get()` migrates and writes back per the existing
   * contract (`decode(key, raw, true)`).
   */
  function decodeExternal(key: string, raw: string): unknown | null {
    return decode(key, raw, false)
  }

  function handleCorrupt(key: string, cause: unknown): void {
    const storageError = new StorageError(
      'CORRUPT_DATA',
      `Vobs Storage: data for key ${key} is corrupt`,
      key,
      cause
    )
    report(storageError)
    withBackend(key, () => backend.removeItem(toPhysicalKey(key)))
  }

  function withBackend<T>(key: string, operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      if (isQuotaError(error)) {
        /*
         * A quota/capacity error ≠ backend unavailable: the disk is still there, reads still work,
         * and writes succeed again once space is freed.
         *
         * This used to take the same path as "backend is truly dead" (`backend = fallback; kind =
         * 'memory'`), so a single QuotaExceededError caused four problems: ① existing data on disk
         * read back as null via get; ② the failed write silently landed in memory but still emitted
         * (subscribers believed it was persisted); ③ after quota recovered, writes never touched
         * disk again; ④ cross-tab storage events all stopped matching because storageArea no longer
         * matched. Now we report honestly and throw; the caller decides.
         */
        const quotaError = new StorageError(
          'QUOTA_EXCEEDED',
          `Vobs Storage: writing key ${key} exceeded the storage quota`,
          key,
          error
        )
        report(quotaError)
        throw quotaError
      }
      if (backend === fallback) {
        const storageError = new StorageError(
          'STORAGE_UNAVAILABLE',
          'Vobs Storage: storage is unavailable',
          key,
          error
        )
        report(storageError)
        throw storageError
      }
      const storageError = new StorageError(
        'STORAGE_UNAVAILABLE',
        'Vobs Storage: storage is unavailable, switched to the in-memory fallback',
        key,
        error
      )
      report(storageError)
      backend = fallback
      kind = 'memory'
      return operation()
    }
  }

  function listPhysicalKeys(): string[] {
    const keys: string[] = []
    for (let index = 0; index < backend.length; index++) {
      const key = backend.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    return keys
  }

  function emit(change: StorageChange): void {
    for (const listener of [...listeners]) {
      try {
        listener(change)
      } catch {
        // A subscriber's error must not prevent other subscribers from receiving the change.
      }
    }
  }

  function report(error: StorageError): void {
    try {
      options.onError?.(error)
    } catch {
      // An error callback must not override the original result of the storage operation.
    }
  }

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs Storage: cannot use a disposed context')
  }

  function toPhysicalKey(key: string): string {
    return `${prefix}${key}`
  }
}

export function storagePlugin(options: StoragePluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/storage',
    version: '0.1.0',
    install(context) {
      const ownedStorage = options.context ? undefined : createStorage(options)
      context.provide(STORAGE_KEY, options.context ?? ownedStorage!)
      return () => ownedStorage?.dispose()
    }
  }
}

export function useStorage(): StorageContext {
  const storage = inject(STORAGE_KEY)
  if (!storage) throw new StorageError('STORAGE_UNAVAILABLE', 'Vobs Storage: context not found; install storagePlugin first')
  return storage
}

function resolveStorage(input: StorageLike | StorageType | undefined): {
  backend: StorageLike | undefined
  kind: StorageKind
  browserStorage: boolean
} {
  if (input && typeof input !== 'string') return { backend: input, kind: 'custom', browserStorage: false }
  const type = input ?? 'local'
  if (type === 'memory') {
    // One instance per context: this used to return the module-level memoryStorage singleton, so two
    // createStorage({ storage: 'memory' }) calls **shared data** — requests leaked into each other
    // across SSR multi-request runs (same family as resource's default client-side singleton).
    // To share explicitly, pass the exported memoryStorage.
    return { backend: createMemoryStorage(), kind: 'memory', browserStorage: false }
  }
  const backend = getBrowserStorage(type)
  return { backend, kind: backend ? type : 'memory', browserStorage: Boolean(backend) }
}

/**
 * Quota/capacity errors: the backend is still usable, it just couldn't fit this write. Never treat
 * these as "storage unavailable" and permanently degrade to memory. Detection is based on the Web
 * standard QuotaExceededError (DOMException code 22) and Firefox's NS_ERROR_DOM_QUOTA_REACHED
 * (code 1014), plus one narrow message fallback.
 */
function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown }
  if (candidate.name === 'QuotaExceededError' || candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if (candidate.code === 22 || candidate.code === 1014) return true
  return typeof candidate.message === 'string' && /quota|storage full/iu.test(candidate.message)
}

function getBrowserStorage(type: Exclude<StorageType, 'memory'>): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return type === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return undefined
  }
}

function isEnvelope(value: unknown): value is Envelope {
  // No longer requires `'value' in value`: JSON **drops** undefined/function/Symbol values, so the
  // envelope persisted by `set(key, undefined)` has no value key. The old check treated that record
  // as "a historical value without an envelope", so `get` returned the envelope object itself
  // `{ __vobsStorage: true, version: 1 }` as data.
  return Boolean(value)
    && typeof value === 'object'
    && value !== null
    && (value as { __vobsStorage?: unknown }).__vobsStorage === true
    && Number.isInteger((value as { version?: unknown }).version)
}

function validateKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Vobs Storage: key must not be empty')
  return key
}

function validateVersion(version: number): number {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('Vobs Storage: version must be an integer greater than or equal to 0')
  }
  return version
}
