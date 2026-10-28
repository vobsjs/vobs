// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

/*
 * Dedupe must not merge requests with "different identities".
 *
 * `getDedupeKey` used to be just `METHOD url`, with headers not participating at all — so two
 * concurrent GETs with the same URL were merged even with different Authorization headers: B's
 * request was never sent at all and B got A's response directly (wrong data, a security issue).
 *
 * Now the key includes credential-class headers (authorization / cookie / proxy-authorization);
 * other headers do not participate, so dedupe's value is unaffected.
 */
const jsonResponse = (data: unknown): Response => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' }
})

describe('http dedupe identity isolation', () => {
  it('concurrent GETs with different Authorization headers do not replace each other', async () => {
    const adapter = vi.fn(async (config: { headers?: Record<string, string> }) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return jsonResponse({ token: config.headers?.authorization ?? 'none' })
    })
    const client = createHTTPClient({ adapter: adapter as never })

    const [a, b] = await Promise.all([
      client.get<{ token: string }>('/me', { dedupe: true, headers: { authorization: 'Bearer A' } }),
      client.get<{ token: string }>('/me', { dedupe: true, headers: { authorization: 'Bearer B' } })
    ])

    expect(adapter).toHaveBeenCalledTimes(2)          // used to be 1 (B got A's data)
    expect(a.data.token).toBe('Bearer A')
    expect(b.data.token, 'B received A\'s response').toBe('Bearer B')
  })

  it('dedupe for the same identity still works (the feature was not broken along the way)', async () => {
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

  it('existing usage without credential headers behaves unchanged', async () => {
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
