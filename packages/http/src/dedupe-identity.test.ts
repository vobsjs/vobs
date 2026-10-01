// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

/*
 * 去重不能把"不同身份"的请求合并。
 *
 * `getDedupeKey` 原来只有 `METHOD url`，headers 完全不参与 —— 于是两个并发 GET 只要 URL 相同
 * 就合并，哪怕 Authorization 不同：B 的请求根本不会发出，直接拿到 A 的响应（拿错数据，安全问题）。
 *
 * 现在键纳入凭据类头（authorization / cookie / proxy-authorization），其余头不参与，
 * 去重的价值不受影响。
 */
const jsonResponse = (data: unknown): Response => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' }
})

describe('http 去重的身份隔离', () => {
  it('不同 Authorization 的并发 GET 不会互相顶替', async () => {
    const adapter = vi.fn(async (config: { headers?: Record<string, string> }) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return jsonResponse({ token: config.headers?.authorization ?? 'none' })
    })
    const client = createHTTPClient({ adapter: adapter as never })

    const [a, b] = await Promise.all([
      client.get<{ token: string }>('/me', { dedupe: true, headers: { authorization: 'Bearer A' } }),
      client.get<{ token: string }>('/me', { dedupe: true, headers: { authorization: 'Bearer B' } })
    ])

    expect(adapter).toHaveBeenCalledTimes(2)          // 原来是 1（B 拿到 A 的数据）
    expect(a.data.token).toBe('Bearer A')
    expect(b.data.token, 'B 拿到了 A 的响应').toBe('Bearer B')
  })

  it('同一身份的去重照旧生效（没有把功能一起打死）', async () => {
    let resolve!: (response: Response) => void
    const adapter = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const client = createHTTPClient({ adapter })

    const first = client.get('/same', { dedupe: true, headers: { authorization: 'Bearer A' } })
    const second = client.get('/same', { dedupe: true, headers: { authorization: 'Bearer A' } })
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
    resolve(jsonResponse({ ok: true }))
    await Promise.all([first, second])
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('不带凭据头的既有用法行为不变', async () => {
    let resolve!: (response: Response) => void
    const adapter = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const client = createHTTPClient({ adapter })

    const first = client.get('/same', { dedupe: true })
    const second = client.get('/same', { dedupe: true })
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
    resolve(jsonResponse({ ok: true }))
    await Promise.all([first, second])
    expect(adapter).toHaveBeenCalledTimes(1)
  })
})
