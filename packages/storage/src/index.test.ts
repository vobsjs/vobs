import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createText, createVobs, createDOMRenderer, setRenderer } from '@vobs/vobs'
import {
  STORAGE_KEY,
  StorageError,
  createMemoryStorage,
  createStorage,
  memoryStorage,
  storagePlugin,
  useStorage
} from './index'

describe('@vobs/storage', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('supports JSON set/get, has, keys, remove, and prefix isolation', () => {
    const storage = createStorage({ storage: 'memory', prefix: 'test:' })
    storage.set('user', { id: '1', roles: ['admin'] })
    storage.set('count', 2)

    expect(storage.get('user')).toEqual({ id: '1', roles: ['admin'] })
    expect(storage.has('count')).toBe(true)
    expect(storage.keys()).toEqual(['user', 'count'])
    expect(storage.get('missing')).toBeNull()
    storage.remove('count')
    expect(storage.has('count')).toBe(false)
    expect(storage.keys()).toEqual(['user'])
    storage.dispose()
  })

  it('prefers localStorage/sessionStorage and falls back to memory on SSR or when unavailable', () => {
    const local = createStorage({ prefix: 'local:' })
    const session = createStorage({ storage: 'session', prefix: 'session:' })
    local.set('value', 'local')
    session.set('value', 'session')
    expect(window.localStorage.getItem('local:value')).toContain('local')
    expect(window.sessionStorage.getItem('session:value')).toContain('session')
    expect(local.kind).toBe('local')
    expect(session.kind).toBe('session')

    const broken: Storage = {
      get length(): number { throw new Error('blocked') },
      getItem(): string | null { throw new Error('blocked') },
      setItem(): void { throw new Error('blocked') },
      removeItem(): void { throw new Error('blocked') },
      key(): string | null { throw new Error('blocked') },
      clear(): void { throw new Error('blocked') }
    }
    const onError = vi.fn()
    const fallback = createMemoryStorage()
    const degraded = createStorage({ storage: broken, fallback, onError })
    degraded.set('value', 'memory')
    expect(degraded.kind).toBe('memory')
    expect(degraded.get('value')).toBe('memory')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }))
    local.dispose()
    session.dispose()
    degraded.dispose()
  })

  it('reports an error, removes the bad value, and returns null for corrupt JSON', () => {
    const backend = createMemoryStorage()
    backend.setItem('vobs:broken', '{not-json')
    const onError = vi.fn()
    const storage = createStorage({ storage: backend, onError })

    expect(storage.get('broken')).toBeNull()
    expect(backend.getItem('vobs:broken')).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'CORRUPT_DATA' }))
    storage.dispose()
  })

  it('runs migration on older versions and persists the new envelope', () => {
    const backend = createMemoryStorage()
    backend.setItem('vobs:settings', JSON.stringify({ __vobsStorage: true, version: 1, value: { compact: true } }))
    const migrate = vi.fn((value: unknown, from: number, to: number) => ({
      density: (value as { compact: boolean }).compact ? 'compact' : 'comfortable',
      migrated: `${from}->${to}`
    }))
    const storage = createStorage({ storage: backend, version: 2, migrate })

    expect(storage.get('settings')).toEqual({ density: 'compact', migrated: '1->2' })
    expect(migrate).toHaveBeenCalledWith({ compact: true }, 1, 2)
    expect(backend.getItem('vobs:settings')).toContain('"version":2')
    storage.dispose()
  })

  it('returns null and keeps the old data when migration fails', () => {
    const backend = createMemoryStorage()
    const oldValue = JSON.stringify({ __vobsStorage: true, version: 1, value: { old: true } })
    backend.setItem('vobs:settings', oldValue)
    const onError = vi.fn()
    const storage = createStorage({
      storage: backend,
      version: 2,
      migrate: () => { throw new Error('cannot migrate') },
      onError
    })

    expect(storage.get('settings')).toBeNull()
    expect(backend.getItem('vobs:settings')).toBe(oldValue)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'MIGRATION_FAILED' }))
    storage.dispose()
  })

  it('subscribes to local writes, removals, clears, and cross-tab browser changes', () => {
    const storage = createStorage({ prefix: 'events:' })
    const changes: string[] = []
    storage.subscribe(change => changes.push(`${change.source}:${change.key}:${String(change.value)}`))
    storage.set('one', 1)
    storage.remove('one')
    storage.set('two', 2)
    storage.clear()
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'events:remote',
      newValue: JSON.stringify({ __vobsStorage: true, version: 1, value: 'yes' }),
      storageArea: window.localStorage
    }))

    expect(changes).toEqual([
      'local:one:1',
      'local:one:null',
      'local:two:2',
      'local:two:null',
      'external:remote:yes'
    ])
    storage.dispose()
  })

  /*
   * #7: old-version data arriving via external storage events used to **skip migrate**
   * (decodeExternal only did JSON.parse + unwrap), so the same data appeared as `{old:1}` in
   * subscribers' hands but `{migrated:{old:1}}` via get().
   * The event path now reuses the read path's migration, but **migrates without writing back**:
   * writing back would put a write side effect back on the notification path, and would trigger
   * another storage event on the other tab — two tabs writing to each other becomes a cross-tab
   * write storm.
   */
  it('runs migrate on external storage events and hands subscribers the current version, without writing back to storage', () => {
    const oldRaw = JSON.stringify({ __vobsStorage: true, version: 1, value: { old: 1 } })
    window.localStorage.setItem('ext:migrating', oldRaw)
    const migrate = vi.fn((value: unknown, from: number, to: number) => ({ migrated: value, from, to }))
    const changes: { source: string; key: string; value: unknown }[] = []
    const storage = createStorage({ prefix: 'ext:', version: 2, migrate })
    storage.subscribe(change => changes.push({ source: change.source, key: change.key, value: change.value }))

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'ext:migrating',
      newValue: oldRaw,
      storageArea: window.localStorage
    }))

    expect(changes).toEqual([
      { source: 'external', key: 'migrating', value: { migrated: { old: 1 }, from: 1, to: 2 } }
    ])
    expect(migrate).toHaveBeenCalledWith({ old: 1 }, 1, 2)
    // The event path only broadcasts, never writes back: the old envelope stays on disk
    expect(window.localStorage.getItem('ext:migrating')).toBe(oldRaw)

    // A real read migrates and writes back per the existing contract — the read path's write side
    // effect belongs only to get()
    expect(storage.get('migrating')).toEqual({ migrated: { old: 1 }, from: 1, to: 2 })
    expect(window.localStorage.getItem('ext:migrating')).toContain('"version":2')
    storage.dispose()
  })

  it('reports MIGRATION_FAILED on external-event migration failure, broadcasts null, does not write back, and keeps the old value on disk', () => {
    const oldRaw = JSON.stringify({ __vobsStorage: true, version: 1, value: { old: 1 } })
    window.localStorage.setItem('extbad:settings', oldRaw)
    const onError = vi.fn()
    const changes: unknown[] = []
    const storage = createStorage({
      prefix: 'extbad:',
      version: 2,
      migrate: () => { throw new Error('cannot migrate') },
      onError
    })
    storage.subscribe(change => changes.push(change.value))

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'extbad:settings',
      newValue: oldRaw,
      storageArea: window.localStorage
    }))

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'MIGRATION_FAILED' }))
    // Consistent with get(): if it can't migrate there is no deliverable value (get is null too),
    // and the old data stays on disk untouched
    expect(changes).toEqual([null])
    expect(storage.get('settings')).toBeNull()
    expect(window.localStorage.getItem('extbad:settings')).toBe(oldRaw)
    storage.dispose()
  })

  it('delivers external events as-is without calling migrate when the envelope version is not older than the current one', () => {
    const newerRaw = JSON.stringify({ __vobsStorage: true, version: 3, value: { future: true } })
    const migrate = vi.fn()
    const changes: unknown[] = []
    const storage = createStorage({ prefix: 'extnew:', version: 2, migrate })
    storage.subscribe(change => changes.push(change.value))

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'extnew:settings',
      newValue: newerRaw,
      storageArea: window.localStorage
    }))

    expect(changes).toEqual([{ future: true }])
    expect(migrate).not.toHaveBeenCalled()
    storage.dispose()
  })

  it('runs migrate with fromVersion=0 for legacy envelope-less values in external events, consistent with get()', () => {
    const changes: unknown[] = []
    const migrate = vi.fn((value: unknown) => ({ migrated: value }))
    const storage = createStorage({ prefix: 'extraw:', version: 2, migrate })
    storage.subscribe(change => changes.push(change.value))

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'extraw:legacy',
      newValue: JSON.stringify({ theme: 'dark' }),
      storageArea: window.localStorage
    }))

    expect(changes).toEqual([{ migrated: { theme: 'dark' } }])
    expect(migrate).toHaveBeenCalledWith({ theme: 'dark' }, 0, 2)
    storage.dispose()
  })

  it('injects StorageContext via the plugin and makes the context unusable after app destruction', () => {
    let injected: ReturnType<typeof createStorage> | undefined
    const app = createVobs({
      render: () => createText('app'),
      plugins: [{
        name: 'consumer',
        requires: [storagePlugin({ storage: 'memory' })],
        install(context) { injected = context.inject(STORAGE_KEY) }
      }]
    })
    expect(injected).toBeDefined()
    injected?.set('answer', 42)
    expect(injected?.get('answer')).toBe(42)
    app.destroy()
    expect(() => injected?.get('answer')).toThrow('disposed')
  })

  /*
   * A quota/capacity error (QuotaExceededError) means the backend is **still usable**: reads work
   * and writes work again once space is freed. withBackend used to run
   * `backend = fallback; kind = 'memory'` on **every** exception, so:
   * existing data on disk read back as null via get · writes silently landed in memory but still
   * emitted (subscribers believed they were persisted) · after quota recovered, writes never
   * touched disk again · cross-tab storage events all stopped matching on storageArea.
   */
  it('quota errors never permanently degrade the backend: disk data stays readable, recovery really persists, and no fake events are broadcast', () => {
    const backing = createMemoryStorage()
    let quota = false
    const flaky = {
      get length(): number { return backing.length },
      getItem: (key: string) => backing.getItem(key),
      key: (index: number) => backing.key(index),
      removeItem: (key: string) => backing.removeItem(key),
      setItem(key: string, value: string): void {
        if (quota) {
          const error = new Error('quota exhausted')
          error.name = 'QuotaExceededError'
          throw error
        }
        backing.setItem(key, value)
      }
    }
    const changes: string[] = []
    const onError = vi.fn()
    const storage = createStorage({ storage: flaky, onError })
    storage.subscribe(change => changes.push(`${change.key}:${String(change.value)}`))

    storage.set('a', 1)
    expect(storage.get('a')).toBe(1)

    quota = true
    expect(() => storage.set('b', 2)).toThrowError(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))
    // No degradation happened; disk data is still readable (it used to become null here)
    expect(storage.kind).toBe('custom')
    expect(storage.persistent).toBe(true)
    expect(storage.get('a')).toBe(1)
    // The failed write must not broadcast success
    expect(changes).toEqual(['a:1'])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))

    quota = false
    storage.set('b', 2)
    expect(backing.getItem('vobs:b')).not.toBeNull()
    expect(storage.kind).toBe('custom')
    storage.dispose()
  })

  it('storage:"memory" is independent per context (no longer shared module-level singleton)', () => {
    const first = createStorage({ storage: 'memory' })
    const second = createStorage({ storage: 'memory' })
    first.set('k', 1)
    expect(second.get('k')).toBeNull()
    expect(first.get('k')).toBe(1)
    // Sharing is still possible: pass the exported singleton explicitly
    const shared = createStorage({ storage: memoryStorage, prefix: 'shared-test:' })
    const alsoShared = createStorage({ storage: memoryStorage, prefix: 'shared-test:' })
    shared.set('x', 2)
    expect(alsoShared.get('x')).toBe(2)
    shared.remove('x')
    first.dispose()
    second.dispose()
    shared.dispose()
    alsoShared.dispose()
  })

  it('values JSON cannot represent never make get return the envelope object itself', () => {
    const storage = createStorage({ storage: 'memory' })
    storage.set('u', undefined)
    expect(storage.get('u')).toBeNull()
    storage.set('f', () => 1)
    expect(storage.get('f')).toBeNull()
    storage.dispose()
  })

  it('useStorage gives a clear error when the plugin is not installed', () => {
    const app = createVobs({ render: () => {
      useStorage()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' })
    )
    expect(StorageError).toBeDefined()
  })
})
