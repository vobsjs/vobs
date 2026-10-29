// @vitest-environment jsdom
/*
 * Shared requests: one handle's `dispose()` must not kill a same-key request that **others are
 * still waiting on**.
 *
 * The audit report claimed it would ("dispose() aborts the same-key request another handle is
 * using"). The current source has a `subscribers.size === 0` guard on both `dispose()` and
 * `switchKey()`, so this was **most likely fixed incidentally by later changes** — the conclusion
 * here is measured, not inferred from reading code.
 *
 * Why this is worth locking down: `entry.inFlight` is **shared**
 * (`execute` starts with `if (entry.inFlight) return entry.inFlight`),
 * so an abort kills every caller waiting on the same key. One component unmounting must not fail
 * another component's request — let alone render that failure as an error fallback "data failed
 * to load".
 *
 * Relation to the existing `cancel-cache.test.ts`: that one covers "when only **one** subscriber
 * remains, dispose cancels, and the cancellation writes no error". This file covers "must not
 * cancel while **other subscribers remain**" — exactly the gap.
 */
import { describe, expect, it, vi } from 'vitest'
import { createResourceClient } from './index'

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('shared requests: dispose() only cancels once the last subscriber leaves', () => {
  it('A in flight, B on the same key: A.dispose() does not abort and B still gets data', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    let calls = 0
    const fetcher = (signal: AbortSignal): Promise<string> => {
      calls++
      signals.push(signal)
      return gate.promise
    }

    const a = client.resource({ key: ['shared'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared'], staleTime: 60_000, fetcher })
    // both handles point at the same entry; each fires once on construction (shared inFlight, only one real call)
    await vi.waitFor(() => expect(calls).toBe(1))

    a.dispose()
    expect(
      signals[0]?.aborted,
      'A.dispose() aborted the shared request only B was still waiting on'
    ).toBe(false)

    gate.resolve('payload')
    await vi.waitFor(() => expect(b.data.value).toBe('payload'))
    expect(b.error.value).toBeNull()
    expect(calls).toBe(1)

    b.dispose()
    client.clear()
  })

  it('abort happens only when the last subscriber disposes (cancel semantics untouched)', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    const fetcher = (signal: AbortSignal): Promise<string> => { signals.push(signal); return gate.promise }

    const a = client.resource({ key: ['shared2'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared2'], staleTime: 60_000, fetcher })
    await vi.waitFor(() => expect(signals.length).toBe(1))

    a.dispose()
    expect(signals[0]?.aborted).toBe(false)
    b.dispose()
    // subscribers back to zero → only now should it cancel
    expect(signals[0]?.aborted).toBe(true)

    gate.reject(new Error('cancelled'))
    client.clear()
  })

  it('repeated dispose() is idempotent and the second call must not abort', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    const fetcher = (signal: AbortSignal): Promise<string> => { signals.push(signal); return gate.promise }

    const a = client.resource({ key: ['shared3'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared3'], staleTime: 60_000, fetcher })
    await vi.waitFor(() => expect(signals.length).toBe(1))

    a.dispose()
    a.dispose()
    expect(signals[0]?.aborted).toBe(false)

    gate.resolve('ok')
    await vi.waitFor(() => expect(b.data.value).toBe('ok'))
    b.dispose()
    client.clear()
  })

  it('after A.dispose(), B can still refetch normally', async () => {
    const client = createResourceClient()
    let value = 'first'
    const fetcher = async (): Promise<string> => value

    const a = client.resource({ key: ['shared4'], staleTime: 0, fetcher })
    const b = client.resource({ key: ['shared4'], staleTime: 0, fetcher })
    await a.prefetch()

    a.dispose()
    value = 'second'
    b.invalidate()
    await expect(b.refetch()).resolves.toBe('second')
    expect(b.error.value).toBeNull()

    b.dispose()
    client.clear()
  })
})
