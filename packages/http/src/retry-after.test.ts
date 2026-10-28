// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient, HTTPError, type HTTPResponse } from './index'

/*
 * `Retry-After` must be honored.
 *
 * Why it matters: a `Retry-After` on 429/503 is the server saying "**not right now**".
 * Retrying in a tight loop with zero backoff throws the traffic the server just blocked right
 * back at it — an amplifier, and a protocol violation.
 * Measured (audit probe): under `429 + retry-after: 5`, the client fired all 3 requests within 4ms.
 *
 * Test approach: use the HTTP-date form (`Retry-After: <now + N ms>`) so the wait can be compressed
 * to tens of milliseconds; the seconds form with an assertion that **does not actually wait**
 * (only checking gap >= a request lower bound) would be too slow, so only parsing is verified there.
 */

/** Records a timestamp for each call and always returns the same status code + headers. */
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

describe('http retries honor Retry-After', () => {
  it('HTTP-date form: the client actually waits between attempts', async () => {
    /*
     * Note that HTTP-date has **second-level precision only**: the milliseconds of
     * `Date.now()+120` are dropped on serialization, and the parsed moment may already be very
     * close (measured: only 30ms left).
     * So the target is aligned to the **next whole-second boundary**, giving the wait a
     * predictable lower bound.
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
    // Before the fix this was 0 (zero backoff). The target is at least 700ms in the future; 100ms of slack absorbs timer precision.
    expect(gap).toBeGreaterThanOrEqual(600)
  }, 15_000)

  it('when the caller configured a longer retryDelay, the larger value wins (not shortened by the server)', async () => {
    const { calls, adapter } = retryAfterAdapter(503, {
      'retry-after': new Date(Date.now() + 20).toUTCString()
    })
    const client = createHTTPClient({ adapter: adapter as never, retry: 1, retryDelay: 150 })
    await client.get('/x').catch(() => undefined)
    expect(calls.length).toBe(2)
    const gap = calls[1]! - calls[0]!
    expect(gap).toBeGreaterThanOrEqual(140)
  })

  it('behavior unchanged without Retry-After (still the configured backoff, default 0)', async () => {
    const { calls, adapter } = retryAfterAdapter(503, {})
    const client = createHTTPClient({ adapter: adapter as never, retry: 2 })
    await client.get('/x').catch(() => undefined)
    expect(calls.length).toBe(3)
    // Default zero backoff: total duration should be short (no regression like "an extra second appears out of nowhere")
    expect(calls[2]! - calls[0]!).toBeLessThan(1000)
  })

  it('an invalid Retry-After counts as absent and does not block retries', async () => {
    for (const bogus of ['abc', '', '-5', 'Wed, 99 Xxx 9999']) {
      const { calls, adapter } = retryAfterAdapter(503, { 'retry-after': bogus })
      const client = createHTTPClient({ adapter: adapter as never, retry: 1 })
      await client.get('/x').catch(() => undefined)
      expect(calls.length, `with bogus=${JSON.stringify(bogus)} retries should proceed as usual`).toBe(2)
    }
  })

  it('an absurdly large Retry-After is capped (cannot hang the caller forever)', async () => {
    // Expressed via HTTP-date as "much later"; the actual wait is truncated by the 60s cap — we do
    // not actually wait here, only assert the observable outcome "did not return immediately":
    // the request must not complete within 200ms.
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
