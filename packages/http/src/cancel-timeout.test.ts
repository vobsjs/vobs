// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient } from './index'

/*
 * Cancellation and timeout must be **hard guarantees**, not "suggestions".
 *
 * `HTTPAdapter` is a public extension point and may well never read `config.signal`; http used to
 * do a bare `await requestAdapter(...)`, never racing abort. Consequences: an aborted request was
 * still sent and returned 200; `timeout: 10` only reached the timeout decision once the adapter
 * settled on its own (report measured 74ms); with an adapter that never settles, the promise stayed
 * pending forever (the concurrency gate stayed occupied, dedupe on the same key hung forever).
 *
 * Now abort races the adapter and the request promise is guaranteed to settle. These use real
 * timers + small millisecond values, never fake timers.
 */
const slowAdapter = (delay: number) => async () => {
  await new Promise(resolve => setTimeout(resolve, delay))
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('http cancellation and timeout hard guarantees', () => {
  it('timeout fails the moment it expires, without waiting for the adapter to settle (previously it waited for the adapter)', async () => {
    /*
     * No time-threshold assertions. The original form was "adapter 120ms, assert elapsed < 80ms"
     * with timeout at 15ms — on a busy machine (e.g. other tasks running concurrently) a 15ms timer
     * can drift past 80ms, producing a **false red** (measured 83ms).
     * Instead assert "the request settled before the adapter returned": that is what "hard
     * guarantee" actually means, and it is completely independent of machine speed.
     */
    let adapterSettled = false
    const client = createHTTPClient({
      adapter: async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        adapterSettled = true
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    await expect(client.get('/slow', { timeout: 15 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(adapterSettled, 'the request must fail before the adapter returns').toBe(false)
  })

  it('aborting mid-flight rejects immediately instead of returning 200', async () => {
    const client = createHTTPClient({ adapter: slowAdapter(120) })
    const controller = new AbortController()
    const pending = client.get('/slow', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('when the adapter never settles, abort still makes the promise settle (previously pending forever)', async () => {
    const client = createHTTPClient({ adapter: () => new Promise<Response>(() => {}) })
    const controller = new AbortController()
    const pending = client.get('/never', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(promiseWithTimeout(pending, 300)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('normal requests are unaffected (the race did not change the success path)', async () => {
    const client = createHTTPClient({ adapter: slowAdapter(5) })
    const response = await client.get('/ok')
    expect(response.status).toBe(200)
  })
})

function promiseWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms))
  ])
}
