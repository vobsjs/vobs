import { describe, expect, it, vi } from 'vitest'
import { createElement, createText, createVobs, type VobsPlugin } from '@vobs/vobs'
import { createMemoryHistory, createRouter, routerPlugin } from '@vobs/router'
import { createOwner, state } from '@vobs/reactivity'
import {
  createResourceClient,
  insertResourceBoundary,
  RESOURCE_KEY,
  resourcePlugin,
  resourceRouterPlugin,
  stableSerialize,
  type ResourceRoutePrefetchContext
} from './index'

describe('@vobs/resource', () => {
  it('自动请求并暴露响应式状态', async () => {
    const client = createResourceClient()
    const users = client.resource(() => Promise.resolve([{ id: 1 }]))

    expect(users.loading.value).toBe(true)
    await users.refetch()
    expect(users.data.value).toEqual([{ id: 1 }])
    expect(users.error.value).toBeNull()
    expect(users.loading.value).toBe(false)
  })

  it('prefetchAll 会等待无 key Resource 的进行中请求', async () => {
    let resolve!: (value: string) => void
    let settled = false
    const client = createResourceClient()
    client.resource(() => new Promise<string>(done => { resolve = done }))

    const prefetch = client.prefetchAll().then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolve('ready')
    await prefetch
    expect(settled).toBe(true)
    client.clear()
  })

  it('客户端清理时通过 ResourceFetcher 的 AbortSignal 取消请求', async () => {
    let requestSignal: AbortSignal | undefined
    const client = createResourceClient()
    client.resource(signal => new Promise<string>((_, reject) => {
      requestSignal = signal
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      })
    }))

    await Promise.resolve()
    expect(requestSignal).toBeDefined()
    client.clear()
    expect(requestSignal?.aborted).toBe(true)
    await Promise.resolve()
  })

  it('相同 key 共享缓存和进行中的请求', async () => {
    const client = createResourceClient()
    const fetcher = vi.fn(() => Promise.resolve([{ id: 1 }]))
    const a = client.resource({ key: ['users', { page: 1 }], fetcher, staleTime: 1_000 })
    const b = client.resource({ key: ['users', { page: 1 }], fetcher, staleTime: 1_000 })

    await Promise.all([a.refetch(), b.refetch()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a.data).toBe(b.data)
  })

  it('缓存未过期时复用成功结果，失效后重新请求', async () => {
    const client = createResourceClient()
    const fetcher = vi.fn(() => Promise.resolve(fetcher.mock.calls.length))
    const first = client.resource({ key: ['counter'], fetcher, staleTime: 1_000 })
    await first.refetch()
    const second = client.resource({ key: ['counter'], fetcher, staleTime: 1_000 })
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second.data.value).toBe(1)

    client.invalidate(['counter'])
    await second.refetch()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('mutate 写入共享缓存', async () => {
    const client = createResourceClient()
    const a = client.resource({ key: ['count'], fetcher: () => Promise.resolve(1), staleTime: 1_000 })
    const b = client.resource({ key: ['count'], fetcher: () => Promise.resolve(1), staleTime: 1_000 })
    await a.refetch()

    b.mutate(current => (current ?? 0) + 1)
    expect(a.data.value).toBe(2)
    expect(client.get<number>(['count'])?.data).toBe(2)
  })

  it('飞行中请求完成时不得覆盖 mutate 写入的新数据', async () => {
    let resolveRequest!: (value: number) => void
    const client = createResourceClient()
    const count = client.resource(() => new Promise<number>(resolve => { resolveRequest = resolve }))
    await flushMicrotasks()
    expect(count.loading.value).toBe(true)

    count.mutate(100)
    resolveRequest(1)
    await flushMicrotasks()

    expect(count.loading.value).toBe(false)
    expect(count.data.value).toBe(100)
    expect(count.error.value).toBeNull()
  })

  it('飞行中请求失败时不得把旧错误写回 mutate 后的状态', async () => {
    let rejectRequest!: (reason: Error) => void
    const client = createResourceClient()
    const count = client.resource(() => new Promise<number>((_, reject) => { rejectRequest = reject }))
    await flushMicrotasks()

    count.mutate(100)
    rejectRequest(new Error('stale failure'))
    await flushMicrotasks()

    expect(count.error.value).toBeNull()
    expect(count.data.value).toBe(100)
  })

  it('将失败归一化为 Error 并通知客户端', async () => {
    const onError = vi.fn()
    const client = createResourceClient({ onError })
    const users = client.resource({ key: ['users'], fetcher: () => Promise.reject('offline') })

    await expect(users.refetch()).rejects.toThrow('offline')
    expect(users.error.value).toBeInstanceOf(Error)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('按配置重试失败的请求，并只报告最终失败', async () => {
    const onError = vi.fn()
    const client = createResourceClient({ onError })
    let attempts = 0
    const users = client.resource({
      key: ['users'],
      retry: 2,
      fetcher: () => {
        attempts++
        return attempts < 3 ? Promise.reject(new Error('offline')) : Promise.resolve(['Ada'])
      }
    })

    await users.prefetch()
    expect(attempts).toBe(3)
    expect(users.data.value).toEqual(['Ada'])
    expect(onError).not.toHaveBeenCalled()
    client.clear()
  })

  it('乐观更新在 action 失败时回滚，并保留错误状态', async () => {
    const client = createResourceClient()
    const count = client.resource({ key: ['count'], fetcher: () => Promise.resolve(1) })
    await count.refetch()

    await expect(count.optimistic(value => (value ?? 0) + 1, () => Promise.reject('rejected')))
      .rejects.toThrow('rejected')
    expect(count.data.value).toBe(1)
    expect(count.error.value?.message).toBe('rejected')
    client.clear()
  })

  it('较早的乐观操作失败时不能回滚较晚的写入', async () => {
    let rejectFirst!: (reason: unknown) => void
    const client = createResourceClient()
    const count = client.resource({ key: ['count'], fetcher: () => Promise.resolve(1) })
    await count.refetch()
    const first = count.optimistic(value => (value ?? 0) + 1, () => new Promise<never>((_, reject) => {
      rejectFirst = reject
    }))
    count.mutate(value => (value ?? 0) + 10)
    rejectFirst('first failed')

    await expect(first).rejects.toThrow('first failed')
    expect(count.data.value).toBe(12)
    expect(count.error.value).toBeNull()
    client.clear()
  })

  it('插件提供共享客户端给依赖它的插件', () => {
    const client = createResourceClient()
    let injected: typeof client | undefined
    const consumer: VobsPlugin = {
      name: 'consumer',
      requires: [resourcePlugin({ client })],
      install(context) { injected = context.inject(RESOURCE_KEY) }
    }
    const app = createVobs({ render: () => createText(''), plugins: [consumer] })

    expect(injected).toBe(client)
    app.destroy()
  })

  it('路由进入前并行预取 meta 中的数据，并复用客户端缓存', async () => {
    let calls = 0
    const client = createResourceClient()
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/users',
          component: () => createText('users'),
          meta: {
            prefetch: [
              async ({ client: currentClient }: ResourceRoutePrefetchContext) => {
                const users = currentClient.resource({
                  key: ['users'],
                  fetcher: async () => {
                    calls++
                    return ['Ada']
                  },
                  staleTime: 1_000
                })
                await users.prefetch()
              },
              async ({ route }: ResourceRoutePrefetchContext) => {
                expect(route.path).toBe('/users')
              }
            ]
          }
        }
      ]
    })
    const app = createVobs({
      render: () => createText('app'),
      plugins: [
        routerPlugin({ router }),
        resourcePlugin({ client }),
        resourceRouterPlugin()
      ]
    })

    await router.push('/users')
    await router.push('/')
    await router.push('/users')
    expect(calls).toBe(1)
    app.destroy()
    router.destroy()
    client.clear()
  })

  it('路由预取失败时取消导航并保留当前路由', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/private',
          component: () => createText('private'),
          meta: { prefetch: () => Promise.reject(new Error('prefetch failed')) }
        }
      ]
    })
    const client = createResourceClient()
    const app = createVobs({
      render: () => createText('app'),
      plugins: [
        routerPlugin({ router }),
        resourcePlugin({ client }),
        resourceRouterPlugin()
      ]
    })

    await expect(router.push('/private')).rejects.toThrow('prefetch failed')
    expect(router.currentRoute.value.path).toBe('/')
    app.destroy()
    router.destroy()
    client.clear()
  })

  it('响应式 key 切换时取消旧请求并切换到新缓存条目', async () => {
    const key = state<readonly unknown[]>(['first'])
    const signals = new Map<string, AbortSignal>()
    const resolve = new Map<string, (value: string) => void>()
    const client = createResourceClient()
    const item = client.resource({
      key,
      fetcher: currentSignal => new Promise<string>((done, reject) => {
        const name = String(key.value[0])
        signals.set(name, currentSignal)
        resolve.set(name, done)
        currentSignal.addEventListener('abort', () => reject(new Error('cancelled')))
      })
    })

    await vi.waitFor(() => expect(signals.get('first')).toBeDefined())
    key.value = ['second']
    await vi.waitFor(() => expect(signals.get('second')).toBeDefined())
    expect(signals.get('first')?.aborted).toBe(true)
    expect(item.key).toEqual(['second'])

    resolve.get('second')?.('ready')
    await item.prefetch()
    expect(item.data.value).toBe('ready')
    item.dispose()
    client.clear()
    key.dispose()
  })

  it('stale-while-revalidate 先返回缓存并在后台更新', async () => {
    let calls = 0
    let resolveRefresh!: (value: string) => void
    const client = createResourceClient()
    const item = client.resource({
      key: ['swr'],
      staleTime: 0,
      strategy: 'stale-while-revalidate',
      fetcher: () => {
        calls++
        return calls === 1 ? Promise.resolve('old') : new Promise<string>(resolve => {
          resolveRefresh = resolve
        })
      }
    })

    await item.prefetch()
    item.invalidate()
    const cached = await item.prefetch()
    expect(cached).toBe('old')
    expect(item.data.value).toBe('old')
    expect(item.loading.value).toBe(true)
    resolveRefresh('new')
    await vi.waitFor(() => expect(item.data.value).toBe('new'))
    expect(calls).toBe(2)
    client.clear()
  })

  it('资源所属 Owner 销毁时取消实例请求', async () => {
    let requestSignal: AbortSignal | undefined
    const owner = createOwner()
    const client = createResourceClient()
    owner.run(() => {
      client.resource(signal => new Promise<string>((_, reject) => {
        requestSignal = signal
        signal.addEventListener('abort', () => reject(new Error('cancelled')))
      }))
    })
    await Promise.resolve()
    owner.dispose()
    expect(requestSignal?.aborted).toBe(true)
    client.clear()
  })

  it('稳定序列化对象 key，拒绝循环引用', () => {
    expect(stableSerialize(['users', { page: 1, filter: 'all' }]))
      .toBe(stableSerialize(['users', { filter: 'all', page: 1 }]))
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => stableSerialize(circular)).toThrow('循环引用')
  })

  it('ResourceBoundary 在加载、成功和空数据状态间切换', async () => {
    let resolve!: (value: number | null) => void
    const client = createResourceClient()
    const count = client.resource({
      key: ['count'],
      fetcher: () => new Promise<number | null>(done => { resolve = done })
    })
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertResourceBoundary(root, null, {
          resource: count,
          loading: () => createText('loading'),
          empty: () => createText('empty'),
          children: value => createText(`count: ${value}`)
        })
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    expect(container.textContent).toBe('loading')

    await Promise.resolve()
    resolve(2)
    await count.prefetch()
    app.update()
    expect(container.textContent).toBe('count: 2')

    count.mutate(null)
    app.update()
    expect(container.textContent).toBe('empty')
    app.destroy()
    client.clear()
  })

  it('ResourceBoundary 将失败交给 fallback，并提供重试函数', async () => {
    let attempts = 0
    const client = createResourceClient()
    const users = client.resource({
      key: ['users'],
      fetcher: () => {
        attempts++
        return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(['Ada'])
      }
    })
    let retry: (() => Promise<unknown>) | undefined
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertResourceBoundary(root, null, {
          resource: users,
          fallback: (error, nextRetry) => {
            retry = nextRetry
            return createText(`error: ${error.message}`)
          },
          children: names => createText(names.join(', '))
        })
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)

    await expect(users.prefetch()).rejects.toThrow('offline')
    app.update()
    expect(container.textContent).toBe('error: offline')
    expect(retry).toBeDefined()
    await retry!()
    app.update()
    expect(container.textContent).toBe('Ada')
    app.destroy()
    client.clear()
  })

  it('ResourceBoundary 将 children 渲染异常交给统一错误边界', async () => {
    const client = createResourceClient()
    const resource = client.resource({ key: ['render-error'], fetcher: () => Promise.resolve('data') })
    await resource.prefetch()
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertResourceBoundary(root, null, {
          resource,
          fallback: error => createText(`fallback: ${error.message}`),
          children: () => { throw new Error('render failed') }
        })
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    app.update()
    expect(container.textContent).toBe('fallback: render failed')
    app.destroy()
    client.clear()
  })
})

async function flushMicrotasks(times = 8): Promise<void> {
  for (let index = 0; index < times; index++) await Promise.resolve()
}
