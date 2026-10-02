// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'
import type { ResourceFailure, ResourceKey } from './index'

/*
 * `client.errors()` 是 prefetchAll() 的配套只读失败视图：不抛错的老契约（prefetch-all.test.ts）
 * 保持不变，这里钉住新视图的语义边界 —— 只反映**当前缓存**里出错且未清掉的条目，是快照而非
 * 订阅源，并且外部改动清单不会回写内部状态。
 */
describe('resource.errors 只读失败视图', () => {
  it('混合成功/失败时只列出失败的缓存条目', async () => {
    const client = createResourceClient()
    const boom = new Error('orders 500')
    client.resource({ key: ['orders', 1], fetcher: async () => { throw boom } })
    const healthy = client.resource({ key: ['health'], fetcher: async () => 'ok' })

    await client.prefetchAll()

    const failures = client.errors()
    expect(failures).toHaveLength(1)
    expect(failures[0].key).toEqual(['orders', 1])
    expect(failures[0].error).toBe(boom)
    expect(healthy.error.value).toBeNull()
  })

  it('重试成功后从清单消失', async () => {
    let calls = 0
    const client = createResourceClient()
    const flaky = client.resource({
      key: ['flaky'],
      fetcher: async () => {
        calls++
        if (calls === 1) throw new Error('first attempt')
        return 'ok'
      }
    })

    await client.prefetchAll()
    expect(client.errors().map(failure => failure.key)).toEqual([['flaky']])

    await flaky.refetch()

    expect(flaky.error.value).toBeNull()
    expect(client.errors()).toEqual([])
  })

  it('clear() 后为空', async () => {
    const client = createResourceClient()
    client.resource({ key: ['gone'], fetcher: async () => { throw new Error('gone') } })

    await client.prefetchAll()
    expect(client.errors()).toHaveLength(1)

    client.clear()

    expect(client.errors()).toEqual([])
  })

  it('返回只读快照：改动清单不影响内部状态', async () => {
    const client = createResourceClient()
    const boom = new Error('boom')
    const failing = client.resource({ key: ['k'], fetcher: async () => { throw boom } })

    await client.prefetchAll()

    const first = client.errors()
    const second = client.errors()
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])

    // 调用方能做的最粗暴改动：改数组长度、改条目字段、塞假条目 —— 一个都不该回写内部状态
    ;(first as ResourceFailure[]).push({ key: ['injected'], error: new Error('injected') })
    ;(first[0] as { error: Error }).error = new Error('overwritten')
    ;(first[0] as { key: ResourceKey }).key = ['overwritten']

    const after = client.errors()
    expect(after).toHaveLength(1)
    expect(after[0].key).toEqual(['k'])
    expect(after[0].error).toBe(boom)
    expect(failing.error.value).toBe(boom)
    expect(client.get(['injected'])).toBeUndefined()
  })

  it('无 key（不缓存）资源的失败不进清单，因为它不在缓存里', async () => {
    const client = createResourceClient()
    const loose = client.resource(async () => { throw new Error('no key') })

    await client.prefetchAll()

    expect(loose.error.value).toBeInstanceOf(Error)
    expect(client.errors()).toEqual([])
  })
})
