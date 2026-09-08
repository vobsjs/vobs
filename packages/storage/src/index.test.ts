import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createText, createVobs, createDOMRenderer, setRenderer } from '@vobs/vobs'
import {
  STORAGE_KEY,
  StorageError,
  createMemoryStorage,
  createStorage,
  storagePlugin,
  useStorage
} from './index'

describe('@vobs/storage', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('支持 JSON set/get、has、keys、remove 和 prefix 隔离', () => {
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

  it('优先使用 localStorage/sessionStorage，并在 SSR 或不可用时使用内存 fallback', () => {
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

  it('损坏 JSON 会报告错误、删除坏值并返回 null', () => {
    const backend = createMemoryStorage()
    backend.setItem('vobs:broken', '{not-json')
    const onError = vi.fn()
    const storage = createStorage({ storage: backend, onError })

    expect(storage.get('broken')).toBeNull()
    expect(backend.getItem('vobs:broken')).toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'CORRUPT_DATA' }))
    storage.dispose()
  })

  it('读取旧版本时执行迁移并保存新 envelope', () => {
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

  it('迁移失败返回 null 且保留旧数据', () => {
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

  it('订阅本实例写入、删除、清空和浏览器跨标签页变化', () => {
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

  it('插件注入 StorageContext，应用销毁后上下文不可用', () => {
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
    expect(() => injected?.get('answer')).toThrow('已销毁')
  })

  it('未安装插件时 useStorage 给出明确错误', () => {
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
