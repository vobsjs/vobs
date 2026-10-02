// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'

/*
 * §12.1 #8 说 `renderToStringAsync` 里 `prefetchAll()` 用 `allSettled` **吞错**。
 * 核实结论：**不抛错是刻意的**（SSR 不该因为一个请求失败就整页 500），而且失败并不"消失" ——
 * 它落在该条目的 `error` 信号上（渲染该资源的组件会走错误态），`dehydrate()` 也**不会**把
 * 出错的条目带去客户端冒充缓存。真正缺的只是"服务端一个聚合的失败清单"，那是新的 API 设计，
 * 不属于"修 bug"。这条测试把现有契约钉住，避免以后有人把它改成 throw（会打断 SSR）或
 * 改成把错误条目也 dehydrate（会让客户端拿到假数据）。
 */
describe('resource.prefetchAll 的失败语义', () => {
  it('不抛错；失败落在条目 error 上，且不进 dehydrate()', async () => {
    const client = createResourceClient()
    const failing = client.resource({
      key: ['failing'],
      fetcher: async () => { throw new Error('boom') }
    })
    const healthy = client.resource({
      key: ['healthy'],
      fetcher: async () => 'value'
    })

    await expect(client.prefetchAll()).resolves.toBeUndefined()

    expect(failing.error.value).toBeInstanceOf(Error)
    expect(healthy.error.value).toBeNull()
    expect(healthy.data.value).toBe('value')

    // 出错的条目不能被脱水成"看起来正常的缓存"
    const serialized = JSON.stringify(client.dehydrate())
    expect(serialized).toContain('healthy')
    expect(serialized).not.toContain('failing')
  })
})
