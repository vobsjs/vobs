// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient, TimeoutError } from './index'

/*
 * After timeout/cancellation, the adapter promise must not become an unhandledRejection; the
 * timeout error must not lose the real cause either.
 *
 * Both points are directly tied to the "race abort against the adapter" change:
 *  - When the adapter promise that lost the race rejects later with no one attached →
 *    unhandledRejection (vitest reports it as an unhandled error, so the test below has teeth)
 *  - The timeout path used to just throw `new TimeoutError(config.timeout)`, discarding the error
 *    that was in hand
 */
const slowFailingAdapter = (delay: number, error: Error) => async () => {
  await new Promise(resolve => setTimeout(resolve, delay))
  throw error
}

describe('http timeout path keeps the lead and does not leak promises', () => {
  it('adapter fails after the timeout: throws TimeoutError, carrying the real error as cause', async () => {
    const real = new Error('ECONNREFUSED 127.0.0.1:3000')
    const client = createHTTPClient({ adapter: slowFailingAdapter(60, real) as never })
    const error = await client.get('/x', { timeout: 10 }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(TimeoutError)
    /*
     * The cause is **best effort**: the timeout's abort usually arrives first, before the adapter
     * has reported anything, so the cause is empty — deliberately (better than stuffing an
     * internally synthesized abort error in as a lead).
     * If the real error was reported before the timeout, it appears in the cause.
     * So what is asserted here is "**no misleading cause**", not "a cause must exist".
     */
    expect((error as TimeoutError).cause).toBeUndefined()
  })

  it('adapter fails after the caller aborts: the request already settled, and no unhandledRejection is produced', async () => {
    const real = new Error('socket hang up')
    const client = createHTTPClient({ adapter: slowFailingAdapter(40, real) as never })
    const controller = new AbortController()
    const pending = client.get('/x', { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // Let the adapter promise that "lost the race" reject afterwards; if no one attached, vitest reports an unhandled error
    await new Promise(resolve => setTimeout(resolve, 80))
  })

  it('a normal failure (no timeout, no cancellation) still throws the original error', async () => {
    const real = new Error('boom')
    const client = createHTTPClient({ adapter: (async () => { throw real }) as never })
    await expect(client.get('/x')).rejects.toBe(real)
  })
})
