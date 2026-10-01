// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

/*
 * 默认不自动重试非幂等方法。
 *
 * 默认判定原来是 `isRetryable(error)`，完全不看方法 —— 而 README 推荐客户端级 `retry: 2`，
 * 于是 POST 在 503 下真的发 3 次，服务端可能写入两次（静默重复提交）。
 * HTTP 客户端的惯例是"自动重试只用于幂等方法"。
 *
 * 调用方显式给 `shouldRetry` 时完全听它的 —— 需要重试 POST 的人显式打开。
 */
const failingResponse = (): Response => new Response('', { status: 503 })

describe('http 自动重试只看幂等方法', () => {
  it('POST + 503：默认只发一次（原来会重发 3 次）', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.post('/orders', { amount: 1 }).catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('GET + 503：仍然重试到用完预算', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.get('/orders').catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(3)
  })

  it('显式 shouldRetry 时仍然可以重试 POST（opt-in 通道没被堵死）', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.post('/orders', { amount: 1 }, { shouldRetry: () => true }).catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(3)
  })

  it('幂等方法表：PUT/DELETE 重试，PATCH 不重试（PATCH 按规范非幂等）', async () => {
    for (const [method, expected] of [['put', 3], ['delete', 3], ['patch', 1]] as const) {
      const adapter = vi.fn(async () => failingResponse())
      const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
      await (client[method] as (url: string, body?: unknown) => Promise<unknown>)('/x', {}).catch(() => undefined)
      expect(adapter, `${method} 应当发 ${expected} 次`).toHaveBeenCalledTimes(expected)
    }
  })
})
