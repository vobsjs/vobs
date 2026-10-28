// @vitest-environment jsdom
/*
 * The dedupe key must include options that **change the response shape**.
 *
 * Dedupe's semantics are "share the same **response**", not "share the same **request**".
 * The original key was just `METHOD url credential headers` — when the same URL concurrently asked
 * for `responseType:'json'` and `'blob'`, the latter sent no request at all and directly received
 * the former's already-parsed object: wrong type and wrong content, and **completely silent**.
 *
 * The criterion is "how many times the adapter was called" (same technique as the existing
 * `dedupe-identity.test.ts`): different shapes → each must go out once; identical shapes → must go
 * out only once.
 */
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const jsonResponse = (data: unknown): Response => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' }
})

/** An adapter that counts its calls. */
function countingAdapter(): { calls: () => number; adapter: unknown } {
  const spy = vi.fn(async () => {
    await sleep(5)
    return jsonResponse({ ok: true })
  })
  return { calls: () => spy.mock.calls.length, adapter: spy }
}

describe('http dedupe key: different response shapes must not be merged', () => {
  it('different responseType → one request each', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'blob', dedupe: true })
    ])
    expect(calls(), 'two requests with different responseType were merged').toBe(2)
  })

  it('different credentials → one request each', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { credentials: 'include', dedupe: true }),
      client.get('/same', { credentials: 'omit', dedupe: true })
    ])
    expect(calls(), 'two requests with different credentials were merged').toBe(2)
  })

  it('different cache → one request each', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { cache: 'default', dedupe: true }),
      client.get('/same', { cache: 'no-store', dedupe: true })
    ])
    expect(calls(), 'two requests with different cache were merged').toBe(2)
  })

  it('identical shapes → still only one request (dedupe\'s value is not broken)', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    const [a, b] = await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'json', dedupe: true })
    ])
    expect(calls(), 'concurrent requests with identical shapes were not merged').toBe(1)
    expect(a.data).toEqual(b.data)
  })

  it('omitted responseType (default json) and explicit json count as the same shape → one request', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { dedupe: true }),
      client.get('/same', { responseType: 'json', dedupe: true })
    ])
    expect(calls(), 'a default value and an explicit value must not count as different shapes').toBe(1)
  })

  it('different credential headers still go out once each (existing semantics not broken)', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { headers: { authorization: 'Bearer a' }, dedupe: true }),
      client.get('/same', { headers: { authorization: 'Bearer b' }, dedupe: true })
    ])
    expect(calls(), 'two requests with different credentials were merged (security issue)').toBe(2)
  })

  it('an explicit dedupeKey still takes over completely (the caller owns the semantics)', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/a', { dedupeKey: 'shared', responseType: 'json' }),
      client.get('/b', { dedupeKey: 'shared', responseType: 'blob' })
    ])
    // With an explicit key the caller decides the semantics: different shapes are merged too (their choice)
    expect(calls()).toBe(1)
  })

  it('no merging with dedupe: false (unaffected by the shape fingerprint)', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { dedupe: false }),
      client.get('/same', { dedupe: false })
    ])
    expect(calls()).toBe(2)
  })

  it('three concurrent requests with different responseType → three requests', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'text', dedupe: true }),
      client.get('/same', { responseType: 'blob', dedupe: true })
    ])
    expect(calls()).toBe(3)
  })

  it('non-concurrent (the previous one already finished) naturally goes out once each', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await client.get('/same', { responseType: 'json', dedupe: true })
    await client.get('/same', { responseType: 'blob', dedupe: true })
    expect(calls()).toBe(2)
  })
})
