// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient, HTTPError, type HTTPResponse } from './index'

/*
 * `Retry-After` 必须被认。
 *
 * 为什么重要：429/503 上的 `Retry-After` 是服务端在说"**别现在来**"。
 * 零退避连环重试等于把服务端挡下的流量原样打回去 —— 是放大器，也违反协议。
 * 实测（审计探针）：`429 + retry-after: 5` 下，客户端 4ms 内把 3 次请求全打完。
 *
 * 测法：用 HTTP-date 形式（`Retry-After: <现在 + N ms>`），这样能把等待压到几十毫秒；
 * 秒数形式另外用一条**不真的等**的断言（只验间隔 >= 请求的下限）会太慢，所以只验解析。
 */

/** 记录每次调用的时间戳，并总是回同一个状态码 + 头。 */
function retryAfterAdapter(status: number, headers: Record<string, string>) {
  const calls: number[] = []
  const adapter = async (): Promise<HTTPResponse<unknown>> => {
    calls.push(Date.now())
    return {
      status,
      statusText: status === 429 ? 'Too Many Requests' : 'Service Unavailable',
      data: { status },
      headers: new Headers(headers),
      config: {} as never
    } as never
  }
  return { calls, adapter }
}

describe('http 重试认 Retry-After', () => {
  it('HTTP-date 形式：两次尝试之间确实等了', async () => {
    /*
     * 注意 HTTP-date **只有秒级精度**：`Date.now()+120` 序列化时毫秒被丢掉，
     * 解析回来的时刻可能已经很近（实测只剩 30ms）。
     * 所以这里把目标对齐到**下一个整秒边界**，让等待时间有可预测的下限。
     */
    const target = Math.ceil((Date.now() + 700) / 1000) * 1000
    const { calls, adapter } = retryAfterAdapter(429, {
      'retry-after': new Date(target).toUTCString()
    })
    const client = createHTTPClient({ adapter: adapter as never, retry: 1 })
    const error = await client.get('/x').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(HTTPError)
    expect((error as HTTPError).status).toBe(429)
    expect(calls.length).toBe(2)
    const gap = calls[1]! - calls[0]!
    // 修复前这里是 0（零退避）。目标至少在未来 700ms，留 100ms 余量抵消定时器精度。
    expect(gap).toBeGreaterThanOrEqual(600)
  }, 15_000)

  it('调用方配了更长的 retryDelay 时，取较大值（不被服务端缩短）', async () => {
    const { calls, adapter } = retryAfterAdapter(503, {
      'retry-after': new Date(Date.now() + 20).toUTCString()
    })
    const client = createHTTPClient({ adapter: adapter as never, retry: 1, retryDelay: 150 })
    await client.get('/x').catch(() => undefined)
    expect(calls.length).toBe(2)
    const gap = calls[1]! - calls[0]!
    expect(gap).toBeGreaterThanOrEqual(140)
  })

  it('没有 Retry-After 时行为不变（仍是配置的退避，默认 0）', async () => {
    const { calls, adapter } = retryAfterAdapter(503, {})
    const client = createHTTPClient({ adapter: adapter as never, retry: 2 })
    await client.get('/x').catch(() => undefined)
    expect(calls.length).toBe(3)
    // 默认零退避：总耗时应很短（不会出现"凭空多等 1 秒"这种回归）
    expect(calls[2]! - calls[0]!).toBeLessThan(1000)
  })

  it('非法的 Retry-After 当作没给，不阻断重试', async () => {
    for (const bogus of ['abc', '', '-5', 'Wed, 99 Xxx 9999']) {
      const { calls, adapter } = retryAfterAdapter(503, { 'retry-after': bogus })
      const client = createHTTPClient({ adapter: adapter as never, retry: 1 })
      await client.get('/x').catch(() => undefined)
      expect(calls.length, `bogus=${JSON.stringify(bogus)} 时应当照常重试`).toBe(2)
    }
  })

  it('荒谬大的 Retry-After 被上限截断（不会把调用方挂死）', async () => {
    // 用 HTTP-date 表达"很久以后"，实际等待会被 60s 上限截断 —— 这里不真的等，
    // 只断言"没有立刻返回"这个可观察结果：请求不该在 200ms 内完成。
    const { adapter } = retryAfterAdapter(503, {
      'retry-after': new Date(Date.now() + 3_600_000).toUTCString()
    })
    const client = createHTTPClient({ adapter: adapter as never, retry: 1 })
    let settled = false
    void client.get('/x').catch(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(settled).toBe(false)
  })
})
