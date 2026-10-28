// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'
import type { ResourceFailure, ResourceKey } from './index'

/*
 * `client.errors()` is the companion read-only failure view of prefetchAll(): the old never-throws
 * contract (prefetch-all.test.ts) stays unchanged; this test pins the new view's semantic
 * boundaries — it only reflects entries in the **current cache** that errored and have not been
 * cleared, it is a snapshot rather than a subscription source, and external mutations of the list
 * never write back into internal state.
 */
describe('resource.errors read-only failure view', () => {
  it('lists only failed cache entries when successes and failures are mixed', async () => {
    const client = createResourceClient()
    const boom = new Error('orders 500')
    client.resource({ key: ['orders', 1], fetcher: async () => { throw boom } })
    const healthy = client.resource({ key: ['health'], fetcher: async () => 'ok' })

    await client.prefetchAll()

    const failures = client.errors()
    expect(failures).toHaveLength(1)
    expect(failures[0].key).toEqual(['orders', 1])
    expect(failures[0].error).toBe(boom)
    expect(healthy.error.value).toBeNull()
  })

  it('disappears from the list once a retry succeeds', async () => {
    let calls = 0
    const client = createResourceClient()
    const flaky = client.resource({
      key: ['flaky'],
      fetcher: async () => {
        calls++
        if (calls === 1) throw new Error('first attempt')
        return 'ok'
      }
    })

    await client.prefetchAll()
    expect(client.errors().map(failure => failure.key)).toEqual([['flaky']])

    await flaky.refetch()

    expect(flaky.error.value).toBeNull()
    expect(client.errors()).toEqual([])
  })

  it('empty after clear()', async () => {
    const client = createResourceClient()
    client.resource({ key: ['gone'], fetcher: async () => { throw new Error('gone') } })

    await client.prefetchAll()
    expect(client.errors()).toHaveLength(1)

    client.clear()

    expect(client.errors()).toEqual([])
  })

  it('returns a read-only snapshot: mutating the list does not affect internal state', async () => {
    const client = createResourceClient()
    const boom = new Error('boom')
    const failing = client.resource({ key: ['k'], fetcher: async () => { throw boom } })

    await client.prefetchAll()

    const first = client.errors()
    const second = client.errors()
    expect(second).not.toBe(first)
    expect(second[0]).not.toBe(first[0])

    // The crudest mutations a caller can attempt: resize the array, change entry fields, inject a
    // fake entry — none of them may write back into internal state
    ;(first as ResourceFailure[]).push({ key: ['injected'], error: new Error('injected') })
    ;(first[0] as { error: Error }).error = new Error('overwritten')
    ;(first[0] as { key: ResourceKey }).key = ['overwritten']

    const after = client.errors()
    expect(after).toHaveLength(1)
    expect(after[0].key).toEqual(['k'])
    expect(after[0].error).toBe(boom)
    expect(failing.error.value).toBe(boom)
    expect(client.get(['injected'])).toBeUndefined()
  })

  it('failures of keyless (uncached) resources never enter the list, because they are not in the cache', async () => {
    const client = createResourceClient()
    const loose = client.resource(async () => { throw new Error('no key') })

    await client.prefetchAll()

    expect(loose.error.value).toBeInstanceOf(Error)
    expect(client.errors()).toEqual([])
  })
})
