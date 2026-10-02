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
  /** JSON 丢掉 undefined/函数/Symbol 值后这个键会消失，所以是可选的。 */
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
      return decode<T>(normalizedKey, raw)
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
          `Vobs Storage: 无法序列化键 ${normalizedKey}`,
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

  function decode<T>(key: string, raw: string): T | null {
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
      write(key, JSON.stringify({ __vobsStorage: true, version, value: migrated } satisfies Envelope))
      return migrated as T | null
    } catch (error) {
      const storageError = new StorageError(
        'MIGRATION_FAILED',
        `Vobs Storage: 键 ${key} 迁移失败`,
        key,
        error
      )
      report(storageError)
      return null
    }
  }

  function decodeExternal(key: string, raw: string): unknown | null {
    try {
      const parsed = JSON.parse(raw)
      return isEnvelope(parsed) ? parsed.value ?? null : parsed
    } catch (error) {
      handleCorrupt(key, error)
      return null
    }
  }

  function handleCorrupt(key: string, cause: unknown): void {
    const storageError = new StorageError(
      'CORRUPT_DATA',
      `Vobs Storage: 键 ${key} 的数据已损坏`,
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
         * 配额/容量错误 ≠ 后端不可用：盘还在、读得到、腾出空间后还能写。
         *
         * 原来这里和"后端真的挂了"走同一条路（`backend = fallback; kind = 'memory'`），于是
         * 一次 QuotaExceededError 就造成四个后果：①盘上原有数据 get 变 null；②这次写入静默
         * 落到内存却照常 emit（订阅者以为已持久化）；③配额恢复后写入永不落盘；④跨标签页
         * storage 事件因 storageArea 不再匹配而全部失效。现在如实报告并抛出，由调用方决定。
         */
        const quotaError = new StorageError(
          'QUOTA_EXCEEDED',
          `Vobs Storage: 键 ${key} 写入超出存储配额`,
          key,
          error
        )
        report(quotaError)
        throw quotaError
      }
      if (backend === fallback) {
        const storageError = new StorageError(
          'STORAGE_UNAVAILABLE',
          'Vobs Storage: 存储不可用',
          key,
          error
        )
        report(storageError)
        throw storageError
      }
      const storageError = new StorageError(
        'STORAGE_UNAVAILABLE',
        'Vobs Storage: 存储不可用，已切换到内存 fallback',
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
        // 订阅者错误不能阻止其他订阅者接收变化。
      }
    }
  }

  function report(error: StorageError): void {
    try {
      options.onError?.(error)
    } catch {
      // 错误回调不能覆盖存储操作的原始结果。
    }
  }

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs Storage: 已销毁的上下文不能继续使用')
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
  if (!storage) throw new StorageError('STORAGE_UNAVAILABLE', 'Vobs Storage: 找不到上下文，请安装 storagePlugin')
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
    // 每个上下文各自一份：原来返回的是模块级 memoryStorage 单例，于是两个
    // createStorage({ storage: 'memory' }) **共享数据** —— SSR 多请求之间互相串数据
    // （与 resource 默认客户端单例同族）。要显式共享就传导出的 memoryStorage。
    return { backend: createMemoryStorage(), kind: 'memory', browserStorage: false }
  }
  const backend = getBrowserStorage(type)
  return { backend, kind: backend ? type : 'memory', browserStorage: Boolean(backend) }
}

/**
 * 配额/容量类错误：后端仍然可用，只是这次写不下。绝不能当成"存储不可用"而永久降级到内存。
 * 识别依据是 Web 标准的 QuotaExceededError（DOMException code 22）与 Firefox 的
 * NS_ERROR_DOM_QUOTA_REACHED（code 1014），外加一条窄消息兜底。
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
  // 不再要求 `'value' in value`：JSON 会**丢掉** undefined/函数/Symbol 值，于是
  // `set(key, undefined)` 落盘的信封没有 value 键。原来那种记录会被当成"没有信封的历史值"，
  // 结果 `get` 把信封对象本身 `{ __vobsStorage: true, version: 1 }` 当数据返回。
  return Boolean(value)
    && typeof value === 'object'
    && value !== null
    && (value as { __vobsStorage?: unknown }).__vobsStorage === true
    && Number.isInteger((value as { version?: unknown }).version)
}

function validateKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) throw new Error('Vobs Storage: key 不能为空')
  return key
}

function validateVersion(version: number): number {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('Vobs Storage: version 必须是大于等于 0 的整数')
  }
  return version
}
