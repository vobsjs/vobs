// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'

/*
 * §12.1 #8 says `prefetchAll()` inside `renderToStringAsync` uses `allSettled` and **swallows
 * errors**. Verified conclusion: **not throwing is deliberate** (SSR must not 500 the whole page
 * because one request failed), and failures do not "disappear" — they land on that entry's `error`
 * signal (the component rendering the resource enters its error state), and `dehydrate()` also
 * **never** carries errored entries to the client masquerading as cache. What was genuinely missing
 * was only "an aggregated server-side failure list" — that is new API design, not a bug fix. This
 * test pins the existing contract so nobody later changes it to throw (would break SSR) or to
 * dehydrate errored entries too (would hand the client fake data).
 */
describe('resource.prefetchAll failure semantics', () => {
  it('does not throw; failures land on entry error and stay out of dehydrate()', async () => {
    const client = createResourceClient()
    const failing = client.resource({
      key: ['failing'],
      fetcher: async () => { throw new Error('boom') }
    })
    const healthy = client.resource({
      key: ['healthy'],
      fetcher: async () => 'value'
    })

    await expect(client.prefetchAll()).resolves.toBeUndefined()

    expect(failing.error.value).toBeInstanceOf(Error)
    expect(healthy.error.value).toBeNull()
    expect(healthy.data.value).toBe('value')

    // an errored entry must not be dehydrated into "cache that looks normal"
    const serialized = JSON.stringify(client.dehydrate())
    expect(serialized).toContain('healthy')
    expect(serialized).not.toContain('failing')
  })
})
