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

  /*
   * 配额/容量错误（QuotaExceededError）说明后端**还能用**：读得到、腾出空间后还能写。
   * 原来 withBackend 对**任何**异常都做 `backend = fallback; kind = 'memory'`，于是：
   * 盘上原有数据 get 变 null · 写入静默进内存还照常 emit（订阅者以为已持久化）·
   * 配额恢复后写入永不落盘 · 跨标签页 storage 事件因 storageArea 不匹配而全部失效。
   */
  it('配额错误不会永久降级后端：盘上数据仍可读、恢复后真的落盘、不广播假事件', () => {
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
    // 没有降级，盘上数据仍然读得到（原来这里变 null）
    expect(storage.kind).toBe('custom')
    expect(storage.persistent).toBe(true)
    expect(storage.get('a')).toBe(1)
    // 失败的那次不得广播成功
    expect(changes).toEqual(['a:1'])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }))

    quota = false
    storage.set('b', 2)
    expect(backing.getItem('vobs:b')).not.toBeNull()
    expect(storage.kind).toBe('custom')
    storage.dispose()
  })

  it('storage:"memory" 每个上下文各自独立（不再共用模块级单例）', () => {
    const first = createStorage({ storage: 'memory' })
    const second = createStorage({ storage: 'memory' })
    first.set('k', 1)
    expect(second.get('k')).toBeNull()
    expect(first.get('k')).toBe(1)
    // 想共用仍然可以：显式传入导出的单例
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

  it('JSON 存不进去的值不会让 get 返回信封对象本身', () => {
    const storage = createStorage({ storage: 'memory' })
    storage.set('u', undefined)
    expect(storage.get('u')).toBeNull()
    storage.set('f', () => 1)
    expect(storage.get('f')).toBeNull()
    storage.dispose()
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
