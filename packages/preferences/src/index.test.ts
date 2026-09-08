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
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(storage.get('global')).toMatchObject({ version: 2, values: { theme: 'light', pageSize: 3 } })
    preferences.dispose()
    storage.dispose()
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
