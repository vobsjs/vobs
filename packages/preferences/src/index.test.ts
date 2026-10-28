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
 * Poll until the condition holds.
 *
 * A fixed `setTimeout(n)` is unreliable under a parallel full test run (timers fire late when the
 * machine is loaded) — tests failing sporadically like that make people distrust the gate, which
 * is worse than having no gate.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`waitFor timed out (${timeoutMs}ms)`)
}

/**
 * Yield two macrotasks: effect flush is a microtask and the `saveDebounce: 0` timer is queued
 * after it, so two 0ms macrotasks suffice to cover "flush has run + the debounce timer is queued".
 * No fixed wall-clock sleep — under parallel load that is the actual source of sporadic reds.
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
  it('provides typed reactive fields, updates, resets, and saving', () => {
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

  it('restores persisted values, falls back to defaults for invalid values, and reports errors', () => {
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

  it('supports version migration and auto-saves with debounce after changes', async () => {
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
     * Never write a fixed wall-clock wait like `await setTimeout(20)`: saveDebounce is 10ms, and
     * when the full suite runs in parallel the machine is loaded, so the timer may not fire within
     * 20ms — this test then fails sporadically (measured: 3/3 in isolation, occasionally red in
     * the full run). Poll until the condition holds; the cap leaves plenty of headroom.
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
   * A real set() after restore() but before the flush (a microtask) got skipped together via
   * `skipNextSave`: measured `restore(); set('pageSize', 99)` → memory 99 / disk still 50, with no
   * error at all. This test pins "a user write in the same synchronous task after restore must
   * reach disk".
   */
  it('a real set within the same flush batch after restore() still persists to disk', async () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'pref:' })
    storage.set('global', { version: 1, values: { pageSize: 50 } })
    const preferences = createPreferences({ preferences: schema, storage, saveDebounce: 0 })
    expect(preferences.pageSize.value).toBe(50)

    // The common app pattern: replay from storage first, then apply a user change — both in the same synchronous task.
    preferences.restore()
    preferences.set('pageSize', 99)
    await settle()

    expect(preferences.pageSize.value).toBe(99)
    expect(storage.get('global')).toMatchObject({ values: { pageSize: 99 } })
    preferences.dispose()
    storage.dispose()
  })

  /*
   * A pending debounce timer is not cancelled by restore(): after another tab's removeItem, the
   * old timer writes the just-restored defaults back to disk — the other side's clearing gets
   * resurrected (measured: `[backend.setItem] vobs:pref:global = {...theme:"light"...}`).
   * This test pins "after an external clear, this tab must not write the key back".
   */
  it('after another tab clears the key, a pending debounced save does not write it back', async () => {
    const physicalKey = 'resurrect:global'
    window.localStorage.removeItem(physicalKey)
    const preferences = createPreferences({
      preferences: schema,
      prefix: 'resurrect:',
      saveDebounce: 100
    })
    preferences.set('theme', 'dark')
    await settle() // flush has run; the 100ms debounce timer is queued but not yet fired

    // Another tab clears the same key (in a real browser this arrives in this tab as a storage event).
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

  it('isolates per user and restores the matching data when the user changes', () => {
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

  it('restores reactive fields from cross-tab changes and notifies subscribers', () => {
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

  it('the plugin injects the context and cleans up after app destruction', () => {
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
    expect(() => injected?.get('theme')).toThrow('disposed')
  })

  it('usePreferences gives a clear error when the plugin is not installed', () => {
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
