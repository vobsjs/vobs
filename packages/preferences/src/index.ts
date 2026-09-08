import { effect, getCurrentOwner, onDispose, state, type Effect, type Signal } from '@vobs/reactivity'
import {
  createInjectionKey,
  inject,
  type InjectionKey,
  type VobsPlugin
} from '@vobs/vobs'
import {
  createStorage,
  type StorageContext,
  type StorageLike,
  type StorageType
} from '@vobs/storage'

export type PreferenceType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface PreferenceDefinition<T> {
  readonly type?: PreferenceType
  readonly default: T
  readonly validate?: (value: unknown) => boolean
}

export type PreferenceSchema = Readonly<Record<string, PreferenceDefinition<unknown>>>
export type PreferenceValue<S extends PreferenceSchema, K extends keyof S> = S[K] extends PreferenceDefinition<infer T> ? T : never
export type PreferenceSignals<S extends PreferenceSchema> = {
  readonly [K in keyof S]: Signal<PreferenceValue<S, K>>
}

export function definePreferences<S extends PreferenceSchema>(schema: S): S {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    throw new Error('Vobs Preferences: schema 不能为空')
  }
  for (const [key, definition] of Object.entries(schema)) {
    if (!definition || typeof definition !== 'object' || !('default' in definition)) {
      throw new Error(`Vobs Preferences: ${key} 缺少 default`)
    }
    validateDefinition(key, definition)
  }
  return schema
}

export type PreferenceErrorCode =
  | 'INVALID_SCHEMA'
  | 'INVALID_VALUE'
  | 'PERSIST_FAILED'
  | 'RESTORE_FAILED'
  | 'MIGRATION_FAILED'

export class PreferenceError extends Error {
  readonly code: PreferenceErrorCode
  readonly key: string | undefined
  readonly cause: unknown

  constructor(code: PreferenceErrorCode, message: string, key?: string, cause?: unknown) {
    super(message)
    this.name = 'PreferenceError'
    this.code = code
    this.key = key
    this.cause = cause
  }
}

export interface PreferenceChange {
  readonly key: string
  readonly value: unknown
  readonly source: 'local' | 'external' | 'restore'
}

export type PreferencesContext<S extends PreferenceSchema = PreferenceSchema> = PreferenceSignals<S> & {
  readonly schema: S
  readonly storage: StorageContext
  readonly userId: string
  readonly storageKey: string
  get<K extends keyof S>(key: K): PreferenceValue<S, K>
  set<K extends keyof S>(key: K, value: PreferenceValue<S, K>): void
  reset<K extends keyof S>(key: K): void
  resetAll(): void
  restore(): void
  save(): void
  subscribe(listener: (change: PreferenceChange) => void): () => void
  dispose(): void
}

export interface PreferencesOptions<S extends PreferenceSchema = PreferenceSchema> {
  readonly preferences: S
  readonly storage?: StorageContext | StorageLike | StorageType
  readonly prefix?: string
  readonly version?: number
  readonly migrate?: (value: Record<string, unknown>, fromVersion: number, toVersion: number) => Record<string, unknown>
  readonly userSpecific?: boolean
  readonly getUserId?: () => string | null | undefined
  readonly autoSave?: boolean
  readonly saveDebounce?: number
  readonly onError?: (error: PreferenceError) => void
}

export interface PreferencesPluginOptions<S extends PreferenceSchema = PreferenceSchema> extends PreferencesOptions<S> {
  readonly context?: PreferencesContext<S>
}

export const PREFERENCES_KEY: InjectionKey<PreferencesContext> = createInjectionKey<PreferencesContext>('vobs.preferences')

interface StoredPreferences {
  readonly version: number
  readonly values: Record<string, unknown>
}

export function createPreferences<S extends PreferenceSchema>(options: PreferencesOptions<S>): PreferencesContext<S> {
  const schema = definePreferences(options.preferences)
  const version = validateVersion(options.version ?? 1)
  const ownedStorage = isStorageContext(options.storage)
    ? undefined
    : createStorage({
      storage: options.storage,
      prefix: options.prefix ?? 'vobs:pref:',
      onError: error => report(new PreferenceError('RESTORE_FAILED', error.message, undefined, error))
    })
  const storage = isStorageContext(options.storage) ? options.storage : ownedStorage!
  const signals = {} as PreferenceSignals<S>
  const listeners = new Set<(change: PreferenceChange) => void>()
  const effects: Effect[] = []
  const userSpecific = options.userSpecific ?? false
  let currentUserId = resolveUserId()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let skipNextSave = false
  let disposed = false

  for (const [key, definition] of Object.entries(schema)) {
    validateValue(key, definition, definition.default)
    ;(signals as Record<string, Signal<unknown>>)[key] = state(definition.default)
  }

  const context = {
    schema,
    storage,
    get userId(): string { return currentUserId },
    get storageKey(): string { return getStorageKey() },

    get<K extends keyof S>(key: K): PreferenceValue<S, K> {
      ensureActive()
      return signals[key].value
    },

    set<K extends keyof S>(key: K, value: PreferenceValue<S, K>): void {
      ensureActive()
      const name = String(key)
      const definition = schema[name]
      validateValue(name, definition, value)
      signals[key].value = value
      emit({ key: name, value, source: 'local' })
    },

    reset<K extends keyof S>(key: K): void {
      context.set(key, schema[String(key)].default as PreferenceValue<S, K>)
    },

    resetAll(): void {
      ensureActive()
      for (const key of Object.keys(schema) as Array<keyof S>) context.reset(key)
    },

    restore(): void {
      ensureActive()
      const key = getStorageKey()
      const stored = storage.get<StoredPreferences>(key)
      skipNextSave = true
      context.resetAll()
      if (!stored || !isStoredPreferences(stored)) return

      let values = stored.values
      if (stored.version < version && options.migrate) {
        try {
          values = options.migrate(values, stored.version, version)
        } catch (error) {
          const preferenceError = new PreferenceError('MIGRATION_FAILED', `Vobs Preferences: ${key} 迁移失败`, key, error)
          report(preferenceError)
          return
        }
      }
      for (const [name, value] of Object.entries(values)) {
        const definition = schema[name]
        if (!definition) continue
        try {
          validateValue(name, definition, value)
          ;(signals as Record<string, Signal<unknown>>)[name].value = value
          emit({ key: name, value, source: 'restore' })
        } catch (error) {
          report(error instanceof PreferenceError ? error : new PreferenceError('RESTORE_FAILED', String(error), name, error))
        }
      }
      if (stored.version < version) context.save()
    },

    save(): void {
      ensureActive()
      const values: Record<string, unknown> = {}
      for (const key of Object.keys(schema)) values[key] = signals[key].value
      try {
        storage.set(getStorageKey(), { version, values } satisfies StoredPreferences)
      } catch (error) {
        const preferenceError = new PreferenceError('PERSIST_FAILED', 'Vobs Preferences: 保存失败', getStorageKey(), error)
        report(preferenceError)
        throw preferenceError
      }
    },

    subscribe(listener: (change: PreferenceChange) => void): () => void {
      ensureActive()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      if (saveTimer !== undefined) clearTimeout(saveTimer)
      for (const reactiveEffect of effects) reactiveEffect.dispose()
      listeners.clear()
      for (const key of Object.keys(schema)) signals[key].dispose()
      ownedStorage?.dispose()
    }
  } as PreferencesContext<S>

  context.restore()

  if (options.autoSave ?? true) {
    effects.push(effect(() => {
      for (const key of Object.keys(schema)) signals[key].value
      if (skipNextSave) {
        skipNextSave = false
        return
      }
      if (saveTimer !== undefined) clearTimeout(saveTimer)
      const delay = validateDelay(options.saveDebounce ?? 0)
      saveTimer = setTimeout(() => {
        if (disposed) return
        try {
          context.save()
        } catch {
          // save() reports the error; an auto-save failure must not break the scheduler.
        }
      }, delay)
    }))
  }

  if (userSpecific && options.getUserId) {
    effects.push(effect(() => {
      const nextUserId = resolveUserId()
      if (nextUserId === currentUserId) return
      currentUserId = nextUserId
      context.restore()
    }))
  }

  const stopStorage = storage.subscribe(change => {
    if (change.source !== 'external' || change.key !== getStorageKey()) return
    context.restore()
  })
  effects.push({ dispose: stopStorage } as Effect)

  if (getCurrentOwner()) onDispose(context.dispose)
  return Object.assign(context, signals)

  function resolveUserId(): string {
    if (!userSpecific) return 'global'
    const value = options.getUserId?.()
    return value && value.trim() ? value : 'anonymous'
  }

  function getStorageKey(): string {
    return isStorageContext(options.storage)
      ? `${options.prefix ?? ''}${currentUserId}`
      : currentUserId
  }

  function report(error: PreferenceError): void {
    try { options.onError?.(error) } catch { /* error handlers must not interrupt preferences */ }
  }

  function emit(change: PreferenceChange): void {
    for (const listener of [...listeners]) {
      try { listener(change) } catch { /* one subscriber cannot block the rest */ }
    }
  }

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs Preferences: 已销毁的上下文不能继续使用')
  }
}

export function preferencesPlugin<S extends PreferenceSchema>(options: PreferencesPluginOptions<S>): VobsPlugin {
  return {
    name: '@vobs/preferences',
    version: '0.1.0',
    install(context) {
      const ownedPreferences = options.context ? undefined : createPreferences(options)
      context.provide(PREFERENCES_KEY, options.context ?? ownedPreferences!)
      return () => ownedPreferences?.dispose()
    }
  }
}

export function usePreferences<S extends PreferenceSchema = PreferenceSchema>(): PreferencesContext<S> {
  const preferences = inject(PREFERENCES_KEY)
  if (!preferences) throw new PreferenceError('RESTORE_FAILED', 'Vobs Preferences: 找不到上下文，请安装 preferencesPlugin')
  return preferences as PreferencesContext<S>
}

function isStorageContext(value: PreferencesOptions['storage']): value is StorageContext {
  return Boolean(value) && typeof value === 'object' && 'subscribe' in value && 'get' in value
}

function isStoredPreferences(value: unknown): value is StoredPreferences {
  return Boolean(value)
    && typeof value === 'object'
    && value !== null
    && Number.isInteger((value as { version?: unknown }).version)
    && typeof (value as { values?: unknown }).values === 'object'
    && (value as { values?: unknown }).values !== null
}

function validateDefinition(key: string, definition: PreferenceDefinition<unknown>): void {
  if (definition.type && !['string', 'number', 'boolean', 'object', 'array'].includes(definition.type)) {
    throw new PreferenceError('INVALID_SCHEMA', `Vobs Preferences: ${key} 的 type 无效`, key)
  }
  validateValue(key, definition, definition.default)
}

function validateValue(key: string, definition: PreferenceDefinition<unknown>, value: unknown): void {
  const matchesType = definition.type === undefined
    || definition.type === 'array' && Array.isArray(value)
    || definition.type === 'object' && Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    || definition.type === 'number' && typeof value === 'number' && Number.isFinite(value)
    || definition.type === 'string' && typeof value === 'string'
    || definition.type === 'boolean' && typeof value === 'boolean'
  if (!matchesType || definition.validate && !definition.validate(value)) {
    throw new PreferenceError('INVALID_VALUE', `Vobs Preferences: ${key} 的值无效`, key)
  }
}

function validateVersion(version: number): number {
  if (!Number.isInteger(version) || version < 0) throw new Error('Vobs Preferences: version 必须是大于等于 0 的整数')
  return version
}

function validateDelay(delay: number): number {
  if (!Number.isFinite(delay) || delay < 0) throw new Error('Vobs Preferences: saveDebounce 必须是大于等于 0 的有限数字')
  return delay
}
