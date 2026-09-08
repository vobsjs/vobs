import type {
  DataTableColumnSettings,
  DataTableColumnSettingsPersistence,
  DataTableColumnSettingsStorage
} from './types'

export function createColumnSettingsPersistence(
  storage: DataTableColumnSettingsStorage,
  key: string
): DataTableColumnSettingsPersistence {
  const normalizedKey = key.trim()
  if (!normalizedKey) throw new Error('VOBS_TABLE001: column settings key 不能为空')

  return {
    load(): DataTableColumnSettings | null | undefined {
      return storage.get<DataTableColumnSettings>(normalizedKey)
    },
    save(settings: DataTableColumnSettings): void {
      storage.set(normalizedKey, settings)
    },
    reset(): void {
      storage.remove(normalizedKey)
    }
  }
}

export function createLocalColumnSettingsPersistence(
  key: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
): DataTableColumnSettingsPersistence {
  const normalizedKey = key.trim()
  if (!normalizedKey) throw new Error('VOBS_TABLE001: column settings key 不能为空')
  const memory = new Map<string, string>()
  let backend = storage ?? resolveLocalStorage()

  return {
    load(): DataTableColumnSettings | undefined {
      const raw = read()
      if (!raw) return undefined
      try {
        const value: unknown = JSON.parse(raw)
        return isColumnSettings(value) ? value : undefined
      } catch {
        return undefined
      }
    },
    save(settings: DataTableColumnSettings): void {
      const raw = JSON.stringify(settings)
      memory.set(normalizedKey, raw)
      try {
        backend?.setItem(normalizedKey, raw)
      } catch {
        backend = undefined
      }
    },
    reset(): void {
      memory.delete(normalizedKey)
      try {
        backend?.removeItem(normalizedKey)
      } catch {
        backend = undefined
      }
    }
  }

  function read(): string | null {
    try {
      return backend?.getItem(normalizedKey) ?? memory.get(normalizedKey) ?? null
    } catch {
      backend = undefined
      return memory.get(normalizedKey) ?? null
    }
  }
}

function resolveLocalStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function isColumnSettings(value: unknown): value is DataTableColumnSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as {
    visibleColumnIds?: unknown
    columnOrder?: unknown
    columnWidths?: unknown
  }
  return Array.isArray(candidate.visibleColumnIds)
    && candidate.visibleColumnIds.every(id => typeof id === 'string')
    && Array.isArray(candidate.columnOrder)
    && candidate.columnOrder.every(id => typeof id === 'string')
    && Boolean(candidate.columnWidths)
    && typeof candidate.columnWidths === 'object'
    && !Array.isArray(candidate.columnWidths)
}
