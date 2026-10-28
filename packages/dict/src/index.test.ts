import { describe, expect, it, vi } from 'vitest'
import { effect } from '@vobs/reactivity'
import { createText, createVobs } from '@vobs/vobs'
import {
  DICT_KEY,
  DictError,
  createDict,
  dictPlugin,
  useDict
} from './index'

const statusItems = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled', disabled: true }
] as const

describe('@vobs/dict', () => {
  it('supports static business dictionaries, querying, value lookup, and label fallback without i18n', () => {
    const dict = createDict({ data: { user_status: statusItems } })
    const query = dict.query('user_status')

    expect(dict.get('user_status')).toEqual(statusItems)
    expect(query.items.value).toEqual(statusItems)
    expect(dict.find('user_status', 'disabled')).toMatchObject({ disabled: true })
    expect(dict.label('user_status', 'active')).toBe('Active')
    expect(dict.label('user_status', 'missing', 'Unknown')).toBe('Unknown')
    dict.set('user_status', [{ value: 1, label: 'One' }])
    expect(query.items.value).toEqual([{ value: 1, label: 'One' }])
    dict.dispose()
  })

  it('deduplicates requests by dictionary name, honors TTL, and reloads after invalidation', async () => {
    let time = 1_000
    const loader = vi.fn(async (name: string) => [{ value: `${name}-${loader.mock.calls.length}`, label: 'Loaded' }])
    const dict = createDict({ loader, staleTime: 100, now: () => time })
    const query = dict.query('roles')

    const [first, second] = await Promise.all([dict.load('roles'), query.load()])
    expect(first).toEqual(second)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(query.loading.value).toBe(false)
    await dict.load('roles')
    expect(loader).toHaveBeenCalledTimes(1)
    time += 100
    await dict.load('roles')
    expect(loader).toHaveBeenCalledTimes(2)
    dict.invalidate('roles')
    await dict.load('roles')
    expect(loader).toHaveBeenCalledTimes(3)
    dict.dispose()
  })

  it('keeps the old dictionary on load failure, exposes the error, and reports to observers', async () => {
    const onError = vi.fn()
    const dict = createDict({
      data: { user_status: statusItems },
      loader: async () => { throw new Error('network unavailable') },
      onError,
      staleTime: 0
    })

    await expect(dict.load('user_status')).rejects.toMatchObject({ code: 'DICT_LOAD_FAILED' })
    expect(dict.get('user_status')).toEqual(statusItems)
    expect(dict.query('user_status').error.value).toMatchObject({ code: 'DICT_LOAD_FAILED' })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'DICT_LOAD_FAILED' }), 'user_status')
    dict.dispose()
  })

  it('does not auto-refire after failure: a plain load() cannot form a microtask retry storm, only explicit retries re-fire', async () => {
    const loader = vi.fn(async () => { throw new Error('offline') })
    const dict = createDict({ loader, staleTime: 0 })
    const query = dict.query('roles')

    // The most ordinary reactive consumer: read error/loading and trigger a load on change.
    // The run cap only exists so the pre-fix bug can't kill the test process (measured: unthrottled
    // it OOM-crashes).
    let runs = 0
    effect(() => {
      void query.error.value
      void query.loading.value
      if (++runs > 30) return
      void query.load().catch(() => {})
    })

    // Run the microtask queue thoroughly: pre-fix, every microtask round re-fired a request
    for (let i = 0; i < 200; i += 1) await Promise.resolve()

    expect(loader).toHaveBeenCalledTimes(1)

    // Explicit retries still work: invalidate / force
    dict.invalidate('roles')
    await expect(dict.load('roles')).rejects.toMatchObject({ code: 'DICT_LOAD_FAILED' })
    expect(loader).toHaveBeenCalledTimes(2)
    await expect(dict.load('roles', { force: true })).rejects.toMatchObject({ code: 'DICT_LOAD_FAILED' })
    expect(loader).toHaveBeenCalledTimes(3)
    dict.dispose()
  })

  it('invalidation aborts in-flight requests and prevents a slow request result from overwriting the cache', async () => {
    let resolveLoader: ((items: readonly { value: string; label: string }[]) => void) | undefined
    let aborted = false
    const dict = createDict({
      loader: (_name, signal) => new Promise(resolve => {
        resolveLoader = resolve
        signal.addEventListener('abort', () => { aborted = true }, { once: true })
      })
    })
    const query = dict.query('roles')
    const pending = dict.load('roles')
    await vi.waitFor(() => expect(query.loading.value).toBe(true))
    dict.invalidate('roles')
    resolveLoader?.([{ value: 'stale', label: 'Stale' }])
    await pending

    expect(aborted).toBe(true)
    expect(query.loading.value).toBe(false)
    expect(dict.get('roles')).toEqual([])
    dict.dispose()
  })

  it('serializes and restores SSR state, and the restored cache does not re-call the loader', async () => {
    let time = 10_000
    const source = createDict({
      data: { user_status: statusItems },
      now: () => time,
      staleTime: 5_000
    })
    const snapshot = source.dehydrate()
    const loader = vi.fn(async () => [{ value: 'unexpected', label: 'Unexpected' }])
    const target = createDict({ loader, now: () => time, staleTime: 5_000 })
    target.hydrate(JSON.stringify(snapshot))

    expect(target.get('user_status')).toEqual(statusItems)
    await expect(target.load('user_status')).resolves.toEqual(statusItems)
    expect(loader).not.toHaveBeenCalled()
    expect(() => target.hydrate({ version: 2, entries: [] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_DEHYDRATED_STATE' })
    )
    source.dispose()
    target.dispose()
  })

  it('dictPlugin injects the context and releases owned state after app destruction', () => {
    let injected: ReturnType<typeof createDict> | undefined
    const app = createVobs({
      render: () => createText('dict'),
      plugins: [
        dictPlugin({ data: { user_status: statusItems } }),
        { name: 'consumer', install(context) { injected = context.inject(DICT_KEY) } }
      ]
    })
    expect(injected?.label('user_status', 'active')).toBe('Active')
    app.destroy()
    expect(() => injected?.get('user_status')).toThrow('disposed')
  })

  it('missing plugin and loader-less loads give clear errors', async () => {
    const noLoader = createDict()
    await expect(noLoader.load('roles')).rejects.toMatchObject({ code: 'DICT_LOADER_MISSING' })
    noLoader.dispose()
    const app = createVobs({ render: () => {
      useDict()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'DICT_CONTEXT_MISSING' })
    )
    expect(DictError).toBeDefined()
  })
})
