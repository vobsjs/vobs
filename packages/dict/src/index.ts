import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type DictName = string
export type DictValue = string | number

export interface DictItem {
  readonly value: DictValue
  readonly label: string
  readonly disabled?: boolean
  readonly [key: string]: unknown
}

export type DictItems = readonly DictItem[]
export type DictData = Readonly<Record<DictName, DictItems>>
export type DictLoader = (name: DictName, signal: AbortSignal) => DictItems | PromiseLike<DictItems>

export interface DictQuery {
  readonly name: DictName
  readonly items: Signal<DictItems>
  readonly loading: Signal<boolean>
  readonly error: Signal<Error | null>
  readonly updatedAt: Signal<number>
  load(options?: { readonly force?: boolean }): Promise<DictItems>
  invalidate(): void
}

export interface DictDehydratedEntry {
  readonly name: DictName
  readonly items: DictItems
  readonly updatedAt: number
}

export interface DictDehydratedState {
  readonly version: 1
  readonly entries: readonly DictDehydratedEntry[]
}

export interface DictOptions {
  readonly data?: DictData
  readonly loader?: DictLoader
  readonly staleTime?: number
  readonly now?: () => number
  readonly onError?: (error: DictError, name: DictName) => void
}

export interface DictPluginOptions extends DictOptions {
  readonly dict?: DictContext
}

export interface DictContext {
  readonly data: Signal<DictData>
  readonly loading: Signal<boolean>
  readonly error: Signal<Error | null>
  readonly staleTime: number
  get(name: DictName): DictItems
  find(name: DictName, value: DictValue): DictItem | undefined
  label(name: DictName, value: DictValue, fallback?: string): string
  query(name: DictName): DictQuery
  load(name: DictName, options?: { readonly force?: boolean }): Promise<DictItems>
  set(name: DictName, items: DictItems): void
  invalidate(name?: DictName): void
  dehydrate(): DictDehydratedState
  hydrate(snapshot: unknown): void
  dispose(): void
}

export type DictErrorCode =
  | 'DICT_CONTEXT_MISSING'
  | 'DICT_CONTEXT_DISPOSED'
  | 'INVALID_DICT_NAME'
  | 'INVALID_DICT_ITEMS'
  | 'DICT_LOADER_MISSING'
  | 'DICT_LOAD_FAILED'
  | 'INVALID_DEHYDRATED_STATE'

export class DictError extends Error {
  readonly code: DictErrorCode
  readonly cause: unknown

  constructor(code: DictErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'DictError'
    this.code = code
    this.cause = cause
  }
}

export const DICT_KEY: InjectionKey<DictContext> = createInjectionKey<DictContext>('vobs.dict')

const EMPTY_ITEMS: DictItems = Object.freeze([])

interface DictEntry extends DictQuery {
  controller: AbortController | null
  inFlight: Promise<DictItems> | null
  revision: number
}

export function createDict(options: DictOptions = {}): DictContext {
  const staleTime = validateStaleTime(options.staleTime ?? 5 * 60 * 1000)
  const now = options.now ?? Date.now
  const initial = normalizeData(options.data ?? {})
  const data = state<DictData>(initial)
  const loading = state(false)
  const error = state<Error | null>(null)
  const entries = new Map<DictName, DictEntry>()
  let disposed = false

  for (const [name, items] of Object.entries(initial)) {
    const entry = createEntry(name, items, now())
    entries.set(name, entry)
  }

  const context: DictContext = {
    data,
    loading,
    error,
    staleTime,

    get(name): DictItems {
      ensureActive()
      return data.value[validateName(name)] ?? EMPTY_ITEMS
    },

    find(name, value): DictItem | undefined {
      ensureActive()
      return context.get(name).find(item => item.value === value)
    },

    label(name, value, fallback): string {
      ensureActive()
      return context.find(name, value)?.label ?? fallback ?? String(value)
    },

    query(name): DictQuery {
      ensureActive()
      return getEntry(validateName(name))
    },

    load(name, loadOptions = {}): Promise<DictItems> {
      ensureActive()
      const entry = getEntry(validateName(name))
      if (!loadOptions.force && isFresh(entry)) return Promise.resolve(entry.items.value)
      if (entry.inFlight) return entry.inFlight
      if (!options.loader) {
        const loadError = new DictError('DICT_LOADER_MISSING', `Vobs Dict: ${entry.name} 未配置 loader`)
        entry.error.value = loadError
        error.value = loadError
        report(loadError, entry.name)
        return Promise.reject(loadError)
      }

      const revision = ++entry.revision
      const controller = new AbortController()
      entry.controller = controller
      entry.loading.value = true
      refreshLoading()
      const request = Promise.resolve()
        .then(() => options.loader!(entry.name, controller.signal))
        .then(items => {
          if (disposed || revision !== entry.revision) return entry.items.value
          const normalized = normalizeItems(items)
          commit(entry, normalized, now(), false)
          return normalized
        })
        .catch(reason => {
          if (disposed || revision !== entry.revision || isAbortError(reason)) return entry.items.value
          const loadError = reason instanceof DictError
            ? reason
            : new DictError('DICT_LOAD_FAILED', `Vobs Dict: ${entry.name} 加载失败`, reason)
          entry.error.value = loadError
          error.value = loadError
          report(loadError, entry.name)
          throw loadError
        })
        .finally(() => {
          if (revision !== entry.revision) return
          entry.inFlight = null
          entry.controller = null
          entry.loading.value = false
          refreshLoading()
        })
      entry.inFlight = request
      return request
    },

    set(name, items): void {
      ensureActive()
      commit(getEntry(validateName(name)), normalizeItems(items), now())
    },

    invalidate(name): void {
      ensureActive()
      if (name === undefined) {
        for (const entry of entries.values()) invalidateEntry(entry)
        return
      }
      invalidateEntry(getEntry(validateName(name)))
    },

    dehydrate(): DictDehydratedState {
      ensureActive()
      return {
        version: 1,
        entries: Object.freeze([...entries.values()]
          .filter(entry => entry.updatedAt.value > 0)
          .map(entry => Object.freeze({
            name: entry.name,
            items: entry.items.value,
            updatedAt: entry.updatedAt.value
          })))
      }
    },

    hydrate(snapshot): void {
      ensureActive()
      const restored = parseDehydratedState(snapshot)
      const nextData: Record<DictName, DictItems> = {}
      const restoredNames = new Set<DictName>()
      for (const item of restored.entries) {
        const entry = getEntry(item.name)
        entry.revision++
        entry.controller?.abort()
        entry.controller = null
        entry.inFlight = null
        entry.loading.value = false
        entry.items.value = item.items
        entry.error.value = null
        entry.updatedAt.value = item.updatedAt
        nextData[item.name] = item.items
        restoredNames.add(item.name)
      }
      for (const [name, entry] of entries) {
        if (restoredNames.has(name)) continue
        entry.revision++
        entry.controller?.abort()
        entry.controller = null
        entry.inFlight = null
        entry.loading.value = false
        entry.items.value = EMPTY_ITEMS
        entry.error.value = null
        entry.updatedAt.value = 0
      }
      data.value = Object.freeze(nextData)
      error.value = null
      refreshLoading()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const entry of entries.values()) {
        entry.controller?.abort()
        entry.items.dispose()
        entry.loading.dispose()
        entry.error.dispose()
        entry.updatedAt.dispose()
      }
      entries.clear()
      data.dispose()
      loading.dispose()
      error.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function getEntry(name: DictName): DictEntry {
    const existing = entries.get(name)
    if (existing) return existing
    const entry = createEntry(name, data.value[name] ?? EMPTY_ITEMS, 0)
    entries.set(name, entry)
    return entry
  }

  function createEntry(name: DictName, items: DictItems, updatedAt: number): DictEntry {
    const entry = {
      name,
      items: state(items),
      loading: state(false),
      error: state<Error | null>(null),
      updatedAt: state(updatedAt),
      controller: null,
      inFlight: null,
      revision: 0,
      load: (loadOptions?: { readonly force?: boolean }) => context.load(name, loadOptions),
      invalidate: () => context.invalidate(name)
    } as DictEntry
    return entry
  }

  function commit(entry: DictEntry, items: DictItems, updatedAt: number, replaceRequest = true): void {
    if (replaceRequest) {
      entry.revision++
      entry.controller?.abort()
      entry.controller = null
      entry.inFlight = null
    }
    entry.items.value = items
    entry.error.value = null
    entry.updatedAt.value = updatedAt
    data.value = Object.freeze({ ...data.value, [entry.name]: items })
    error.value = null
    refreshLoading()
  }

  function invalidateEntry(entry: DictEntry): void {
    entry.revision++
    entry.controller?.abort()
    entry.controller = null
    entry.inFlight = null
    entry.loading.value = false
    entry.updatedAt.value = 0
    refreshLoading()
  }

  function isFresh(entry: DictEntry): boolean {
    return entry.updatedAt.value > 0 && now() - entry.updatedAt.value < staleTime
  }

  function refreshLoading(): void {
    loading.value = [...entries.values()].some(entry => entry.loading.value)
  }

  function report(dictError: DictError, name: DictName): void {
    try { options.onError?.(dictError, name) } catch { /* observers cannot break dictionary state */ }
  }

  function ensureActive(): void {
    if (disposed) throw new DictError('DICT_CONTEXT_DISPOSED', 'Vobs Dict: 上下文已销毁')
  }
}

export function dictPlugin(options: DictPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/dict',
    version: '0.1.0',
    install(context) {
      const ownedDict = options.dict ? undefined : createDict(options)
      context.provide(DICT_KEY, options.dict ?? ownedDict!)
      return () => ownedDict?.dispose()
    }
  }
}

export function useDict(): DictContext {
  const dict = inject(DICT_KEY)
  if (!dict) throw new DictError('DICT_CONTEXT_MISSING', 'Vobs Dict: 找不到上下文，请安装 dictPlugin')
  return dict
}

function validateName(name: string): DictName {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new DictError('INVALID_DICT_NAME', 'Vobs Dict: 字典名必须是非空字符串')
  }
  return name
}

function validateStaleTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new DictError('INVALID_DICT_ITEMS', 'Vobs Dict: staleTime 必须是大于等于 0 的有限数字')
  }
  return value
}

function normalizeData(data: DictData): DictData {
  const normalized: Record<DictName, DictItems> = {}
  for (const [name, items] of Object.entries(data)) normalized[validateName(name)] = normalizeItems(items)
  return Object.freeze(normalized)
}

function normalizeItems(items: unknown): DictItems {
  if (!Array.isArray(items)) throw new DictError('INVALID_DICT_ITEMS', 'Vobs Dict: 字典项必须是数组')
  return Object.freeze(items.map((item, index) => {
    if (!item || typeof item !== 'object'
      || (typeof (item as DictItem).value !== 'string' && typeof (item as DictItem).value !== 'number')
      || typeof (item as DictItem).label !== 'string') {
      throw new DictError('INVALID_DICT_ITEMS', `Vobs Dict: 第 ${index + 1} 个字典项必须包含 value 和 label`)
    }
    return Object.freeze({ ...item }) as DictItem
  }))
}

function parseDehydratedState(snapshot: unknown): DictDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try { value = JSON.parse(snapshot) } catch {
      throw new DictError('INVALID_DEHYDRATED_STATE', 'Vobs Dict: 初始状态不是有效 JSON')
    }
  }
  if (!value || typeof value !== 'object') {
    throw new DictError('INVALID_DEHYDRATED_STATE', 'Vobs Dict: 初始状态格式无效')
  }
  const candidate = value as Partial<DictDehydratedState>
  if (candidate.version !== 1 || !Array.isArray(candidate.entries)) {
    throw new DictError('INVALID_DEHYDRATED_STATE', 'Vobs Dict: 初始状态版本或 entries 无效')
  }
  const seen = new Set<string>()
  const entries = candidate.entries.map(entry => {
    if (!entry || typeof entry !== 'object') {
      throw new DictError('INVALID_DEHYDRATED_STATE', 'Vobs Dict: 初始状态条目无效')
    }
    const name = validateName((entry as Partial<DictDehydratedEntry>).name as string)
    const updatedAt = (entry as Partial<DictDehydratedEntry>).updatedAt
    if (seen.has(name) || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new DictError('INVALID_DEHYDRATED_STATE', 'Vobs Dict: 初始状态条目字段无效')
    }
    seen.add(name)
    return Object.freeze({
      name,
      items: normalizeItems((entry as Partial<DictDehydratedEntry>).items),
      updatedAt
    })
  })
  return { version: 1, entries: Object.freeze(entries) }
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
