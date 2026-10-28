// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { state } from '@vobs/vobs'
import { createResourceClient } from './index'

/*
 * Cancellation is not failure — an AbortError must not stay in the **shared cache**.
 *
 * The original `resource.ts` error branch wrote the error unconditionally whenever the revision was
 * unchanged (only the onError line was guarded by `aborted`). The consequence crossed pages: a
 * refetch cancelled/disposed midway left `{ data, error: AbortError }` in the cache; a new page on
 * the same key, seeing isFresh (staleTime not yet elapsed), picked up that error with **zero
 * requests**, and since the boundary checks error first it rendered the error fallback directly.
 *
 * The repo's existing cancellation case (resource.test.ts's "cancel the old request when a reactive
 * key changes") only asserted the old signal got aborted, **never asserted the cancelled entry's
 * error** — that gap is exactly where the bug was hiding.
 */
describe('resource cancellation vs the shared cache', () => {
  it('a cancelled request writes no error, so a new page on the same key cannot pick up an AbortError with zero requests', async () => {
    const client = createResourceClient()
    let calls = 0
    const makeFetcher = () => (signal: AbortSignal) => {
      calls++
      if (calls === 1) return Promise.resolve('v1')
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')))
      })
    }

    const first = client.resource({ key: ['k'], staleTime: 60_000, fetcher: makeFetcher() })
    await first.prefetch()
    expect(first.data.value).toBe('v1')

    const refetching = first.refetch()          // second request, hangs
    await vi.waitFor(() => expect(calls).toBe(2))
    first.dispose()                             // cancel the in-flight one
    await refetching.catch(() => undefined)

    // a "new page" on the same key
    const callsBefore = calls
    const second = client.resource({ key: ['k'], staleTime: 60_000, fetcher: makeFetcher() })
    await second.prefetch()

    expect(second.error.value, 'the cancelled request wrote an AbortError into the shared cache').toBeNull()
    expect(calls).toBe(callsBefore)             // still fresh → no extra request
    expect(second.data.value).toBe('v1')

    second.dispose()
    client.clear()
  })

  it('a genuine failure still writes error (the cancellation carve-out did not touch the normal error path)', async () => {
    const client = createResourceClient()
    const item = client.resource({ key: ['boom'], fetcher: () => Promise.reject(new Error('网络炸了')) })
    await item.prefetch().catch(() => undefined)
    expect(item.error.value?.message).toBe('网络炸了')
    item.dispose()
    client.clear()
  })

  it('the existing semantics of reactive-key switching cancelling the old request are unchanged', async () => {
    const key = state<readonly unknown[]>(['first'])
    const signals = new Map<string, AbortSignal>()
    const client = createResourceClient()
    const item = client.resource({
      key,
      fetcher: currentSignal => new Promise<string>(() => { signals.set(String(key.value[0]), currentSignal) })
    })
    await vi.waitFor(() => expect(signals.get('first')).toBeDefined())
    key.value = ['second']
    await vi.waitFor(() => expect(signals.get('second')).toBeDefined())
    expect(signals.get('first')?.aborted).toBe(true)
    item.dispose()
    client.clear()
    key.dispose()
  })
})
