import { describe, expect, it, vi } from 'vitest'
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
  it('支持静态业务字典、查询、value 查找和 label 回退，不依赖 i18n', () => {
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

  it('按字典名去重请求、遵守 TTL，并在失效后重新加载', async () => {
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

  it('加载失败保留旧字典、暴露错误并报告观察者', async () => {
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

  it('失效会中止在途请求，并阻止慢请求结果覆盖缓存', async () => {
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

  it('序列化并恢复 SSR 状态，恢复后的缓存不会重复调用 loader', async () => {
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

  it('dictPlugin 注入上下文并在应用销毁后释放自有状态', () => {
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
    expect(() => injected?.get('user_status')).toThrow('已销毁')
  })

  it('未安装插件与无 loader 的加载给出明确错误', async () => {
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
