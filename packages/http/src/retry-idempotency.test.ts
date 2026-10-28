// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

/*
 * Non-idempotent methods are not retried automatically by default.
 *
 * The original default was `isRetryable(error)`, ignoring the method entirely — and the README
 * recommends a client-level `retry: 2`, so a POST really went out 3 times under 503 and the server
 * could write twice (silent duplicate submission). The HTTP-client convention is "automatic retries
 * only for idempotent methods".
 *
 * When the caller supplies `shouldRetry` explicitly, it has full control — anyone who needs POST
 * retried opts in explicitly.
 */
const failingResponse = (): Response => new Response('', { status: 503 })

describe('http automatic retries only consider idempotent methods', () => {
  it('POST + 503: sent only once by default (previously re-sent 3 times)', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.post('/orders', { amount: 1 }).catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('GET + 503: still retried until the budget is exhausted', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.get('/orders').catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(3)
  })

  it('POST can still be retried with an explicit shouldRetry (the opt-in channel is not blocked)', async () => {
    const adapter = vi.fn(async () => failingResponse())
    const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
    await client.post('/orders', { amount: 1 }, { shouldRetry: () => true }).catch(() => undefined)
    expect(adapter).toHaveBeenCalledTimes(3)
  })

  it('idempotent method table: PUT/DELETE retry, PATCH does not (PATCH is non-idempotent per spec)', async () => {
    for (const [method, expected] of [['put', 3], ['delete', 3], ['patch', 1]] as const) {
      const adapter = vi.fn(async () => failingResponse())
      const client = createHTTPClient({ adapter: adapter as never, retry: 2, retryDelay: 0 })
      await (client[method] as (url: string, body?: unknown) => Promise<unknown>)('/x', {}).catch(() => undefined)
      expect(adapter, `${method} should be sent ${expected} time(s)`).toHaveBeenCalledTimes(expected)
    }
  })
})
