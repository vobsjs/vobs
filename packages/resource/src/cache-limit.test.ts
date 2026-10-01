// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'

/*
 * 缓存可选上限（默认不限 = 零行为变更）。
 *
 * 缓存原来只增不减、`clear()` 是唯一出口（报告实测 4000 个 key 后堆增长约 6.7MB）。
 * 现在可以传 `maxEntries`：按**插入顺序**淘汰最旧的条目，**在飞请求跳过**。
 * 缓存大小没有公开接口，所以用"淘汰后同 key 会**重新请求**"来观察。
 */
describe('resource 缓存上限', () => {
  it('超过上限时淘汰最旧的条目（同 key 会重新请求）', async () => {
    const client = createResourceClient({ maxEntries: 2 })
    const calls = new Map<string, number>()
    const make = (name: string) => client.resource({
      key: [name],
      fetcher: () => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        return Promise.resolve(name)
      }
    })

    await make('a').prefetch()
    await make('b').prefetch()
    await make('c').prefetch()          // 此时 a 应当被淘汰

    expect(calls.get('a')).toBe(1)
    await make('a').prefetch()          // 淘汰过 → 重新请求
    expect(calls.get('a'), 'a 没有被淘汰').toBe(2)
    await make('c').prefetch()          // c 还在，不该再请求
    expect(calls.get('c')).toBe(1)

    client.clear()
  })

  it('默认不限时什么都不淘汰（零行为变更）', async () => {
    const client = createResourceClient()
    let calls = 0
    const make = (name: string) => client.resource({
      key: [name],
      fetcher: () => { calls++; return Promise.resolve(name) }
    })
    for (const name of ['a', 'b', 'c', 'd', 'e']) await make(name).prefetch()
    expect(calls).toBe(5)
    await make('a').prefetch()
    expect(calls, '默认不该淘汰').toBe(5)
    client.clear()
  })

  it('在飞的请求不会被淘汰（宁可暂时超限）', async () => {
    const client = createResourceClient({ maxEntries: 1 })
    const resolvers: Array<(value: string) => void> = []
    const make = (name: string) => client.resource({
      key: [name],
      fetcher: () => new Promise<string>(resolve => { resolvers.push(resolve) })
    })

    const first = make('slow')
    const pendingFirst = first.prefetch()
    await Promise.resolve()
    const second = make('other')
    void second.prefetch()               // 触发淘汰判定，但 slow 还在飞 → 不淘汰

    resolvers[0]?.('slow-done')
    await expect(pendingFirst).resolves.toBe('slow-done')
    expect(first.data.value).toBe('slow-done')   // 活跃请求没被破坏
    expect(resolvers.length).toBe(2)
    client.clear()
  })

  it('非法上限直接抛错', () => {
    expect(() => createResourceClient({ maxEntries: 0 })).toThrowError(/maxEntries/)
    expect(() => createResourceClient({ maxEntries: 1.5 })).toThrowError(/maxEntries/)
  })
})
