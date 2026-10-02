import { describe, expect, it, vi } from 'vitest'
import { state } from '@vobs/reactivity'
import { createText, createVobs, createDOMRenderer, setRenderer } from '@vobs/vobs'
import { createStorage, createMemoryStorage } from '@vobs/storage'
import {
  PREFERENCES_KEY,
  PreferenceError,
  createPreferences,
  definePreferences,
  preferencesPlugin,
  usePreferences
} from './index'

/**
 * 轮询等待条件成立。
 *
 * 固定 `setTimeout(n)` 在并行全量测试下不可靠（机器有负载时定时器会晚）——
 * 这类测试偶发失败会让人不再信任门禁，比没有门禁更糟。
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`waitFor 超时（${timeoutMs}ms）`)
}

/**
 * 让出两个宏任务：effect flush 是微任务，`saveDebounce: 0` 的定时器排在它之后，
 * 所以两个 0ms 宏任务足以覆盖"flush 已跑 + 防抖定时器已排上"。
 * 不用固定墙钟睡眠 —— 并行负载下那才是偶发红的来源。
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

const schema = definePreferences({
  theme: { type: 'string', default: 'light', validate: value => value === 'light' || value === 'dark' },
  locale: { type: 'string', default: 'zh-CN' },
  sidebarCollapsed: { type: 'boolean', default: false },
  pageSize: { type: 'number', default: 20 }
})

describe('@vobs/preferences', () => {
  it('提供类型化响应式字段、更新、重置和保存', () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'pref:' })
    const preferences = createPreferences({ preferences: schema, storage, autoSave: false })
    preferences.set('theme', 'dark')
    preferences.set('pageSize', 50)
    expect(preferences.theme.value).toBe('dark')
    expect(preferences.get('pageSize')).toBe(50)
    preferences.reset('theme')
    expect(preferences.theme.value).toBe('light')
    preferences.save()
    expect(storage.get('global')).toMatchObject({ values: { theme: 'light', pageSize: 50 } })
    preferences.resetAll()
    expect(preferences.pageSize.value).toBe(20)
    preferences.dispose()
    storage.dispose()
  })

  it('恢复持久化值，非法值回退默认值并报告错误', () => {
    const backend = createMemoryStorage()
    const storage = createStorage({ storage: backend, prefix: 'pref:' })
    storage.set('global', { version: 1, values: { theme: 'dark', pageSize: 'large' } })
    const onError = vi.fn()
    const preferences = createPreferences({ preferences: schema, storage, autoSave: false, onError })
    expect(preferences.theme.value).toBe('dark')
    expect(preferences.pageSize.value).toBe(20)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_VALUE', key: 'pageSize' }))
    preferences.dispose()
    storage.dispose()
  })

  it('支持版本迁移并在变更后自动防抖保存', async () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'pref:' })
    storage.set('global', { version: 1, values: { theme: 'dark', locale: 'zh-CN' } })
    const preferences = createPreferences({
      preferences: schema,
      storage,
      version: 2,
      migrate: (values, from, to) => ({ ...values, pageSize: from + to }),
      saveDebounce: 10
    })
    expect(preferences.pageSize.value).toBe(3)
    preferences.set('theme', 'light')
    /*
     * 不能写 `await setTimeout(20)` 这种固定墙钟等待：saveDebounce 是 10ms，
     * 并行跑全量测试时机器有负载，定时器可能来不及在 20ms 内跑完 ——
     * 于是这条测试偶发失败（实测单独跑 3/3 通过、全量下偶发红）。
     * 轮询到条件成立即返回，上限给足余量。
     */
    await waitFor(() => {
      const saved = storage.get('global') as { values?: { theme?: string } } | undefined
      return saved?.values?.theme === 'light'
    }, 1000)
    expect(storage.get('global')).toMatchObject({ version: 2, values: { theme: 'light', pageSize: 3 } })
    preferences.dispose()
    storage.dispose()
  })

  /*
   * restore() 之后、flush（微任务）之前的真实 set() 会被 `skipNextSave` 一起跳过：
   * 实测 `restore(); set('pageSize', 99)` → 内存 99 / 盘上仍是 50，且没有任何报错。
   * 这条用例钉住"恢复之后同一个同步任务里的用户写入必须落盘"。
   */
  it('restore() 之后同一批 flush 里的真实 set 仍然落盘', async () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'pref:' })
    storage.set('global', { version: 1, values: { pageSize: 50 } })
    const preferences = createPreferences({ preferences: schema, storage, saveDebounce: 0 })
    expect(preferences.pageSize.value).toBe(50)

    // 应用里的常见写法：先按存储重放，再应用一次用户改动 —— 两者在同一个同步任务里。
    preferences.restore()
    preferences.set('pageSize', 99)
    await settle()

    expect(preferences.pageSize.value).toBe(99)
    expect(storage.get('global')).toMatchObject({ values: { pageSize: 99 } })
    preferences.dispose()
    storage.dispose()
  })

  /*
   * 待触发的防抖定时器不被 restore() 取消：另一标签页 removeItem 之后，旧定时器把刚恢复的
   * 默认值写回盘上 —— 对方的清空被复活（实测 `[backend.setItem] vobs:pref:global = {...theme:"light"...}`）。
   * 这条用例钉住"外部清空之后本标签页不再把该键写回"。
   */
  it('另一标签页清空后，待触发的防抖保存不会把该键写回', async () => {
    const physicalKey = 'resurrect:global'
    window.localStorage.removeItem(physicalKey)
    const preferences = createPreferences({
      preferences: schema,
      prefix: 'resurrect:',
      saveDebounce: 100
    })
    preferences.set('theme', 'dark')
    await settle() // flush 已跑，100ms 防抖定时器已排上但还没触发

    // 另一个标签页清空同一个键（真实浏览器里以 storage 事件到达本标签页）。
    window.localStorage.removeItem(physicalKey)
    window.dispatchEvent(new StorageEvent('storage', {
      key: physicalKey,
      newValue: null,
      storageArea: window.localStorage
    }))
    expect(preferences.theme.value).toBe('light')

    await new Promise(resolve => setTimeout(resolve, 250))
    expect(window.localStorage.getItem(physicalKey)).toBeNull()
    preferences.dispose()
    window.localStorage.removeItem(physicalKey)
  })

  it('用户隔离并在用户变化时恢复对应数据', () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'pref:' })
    const user = state<string | null>('one')
    storage.set('one', { version: 1, values: { theme: 'dark' } })
    storage.set('two', { version: 1, values: { theme: 'light', pageSize: 80 } })
    const preferences = createPreferences({
      preferences: schema,
      storage,
      userSpecific: true,
      getUserId: () => user.value,
      autoSave: false
    })
    expect(preferences.theme.value).toBe('dark')
    user.value = 'two'
    // The owner-less reactive effect flushes on the next microtask.
    return Promise.resolve().then(() => {
      expect(preferences.theme.value).toBe('light')
      expect(preferences.pageSize.value).toBe(80)
      preferences.dispose()
      storage.dispose()
    })
  })

  it('跨标签页变化恢复响应式字段，并通知订阅者', () => {
    const storage = createStorage({ prefix: 'pref:' })
    const preferences = createPreferences({ preferences: schema, storage, autoSave: false })
    const changes: string[] = []
    preferences.subscribe(change => changes.push(`${change.source}:${change.key}`))
    window.localStorage.setItem('pref:global', JSON.stringify({
      __vobsStorage: true,
      version: 1,
      value: { version: 1, values: { theme: 'dark' } }
    }))
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'pref:global',
      newValue: window.localStorage.getItem('pref:global'),
      storageArea: window.localStorage
    }))
    expect(preferences.theme.value).toBe('dark')
    expect(changes.some(change => change.endsWith(':theme'))).toBe(true)
    preferences.dispose()
    storage.dispose()
  })

  it('插件注入上下文，并在应用销毁后清理', () => {
    setRenderer(createDOMRenderer())
    let injected: ReturnType<typeof createPreferences> | undefined
    const app = createVobs({
      render: () => createText('app'),
      plugins: [{
        name: 'consumer',
        requires: [preferencesPlugin({ preferences: schema, storage: 'memory', autoSave: false })],
        install(context) { injected = context.inject(PREFERENCES_KEY) as ReturnType<typeof createPreferences> }
      }]
    })
    expect(injected).toBeDefined()
    app.destroy()
    expect(() => injected?.get('theme')).toThrow('已销毁')
  })

  it('未安装插件时 usePreferences 给出明确错误', () => {
    const app = createVobs({ render: () => {
      usePreferences()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'RESTORE_FAILED' })
    )
    expect(PreferenceError).toBeDefined()
  })
})
