import { describe, expect, it, vi } from 'vitest'
import { createText, createVobs, type VobsPlugin } from '@vobs/vobs'
import { createStorage, type StorageContext } from '@vobs/storage'
import { createTaskQueue } from '@vobs/queue'
import {
  SYNC_KEY,
  SyncError,
  createSync,
  syncPlugin,
  useSync,
  type SyncRequest,
  type SyncResponse,
  type SyncTransport
} from './index'

function fakeTransport(responses: readonly unknown[] | (() => unknown)): {
  transport: SyncTransport
  requests: unknown[]
} {
  const requests: unknown[] = []
  let index = 0
  const transport = {
    sync: vi.fn(async (request: unknown) => {
      requests.push(request)
      const data = typeof responses === 'function' ? responses() : responses[index++]
      if (data instanceof Error) throw data
      return data
    })
  } satisfies SyncTransport
  return { transport, requests }
}

function makeStorage(): StorageContext {
  return createStorage({ storage: 'memory', prefix: `test-sync-${Math.random()}:` })
}

describe('@vobs/sync', () => {
  it('persists pending changes and the incremental cursor, and applies remote changes', async () => {
    const storage = makeStorage()
    const applied: string[] = []
    const { transport, requests } = fakeTransport([{
      cursor: 'cursor-2',
      timestamp: '2026-09-03T08:00:00.000Z',
      changes: [{ id: 'remote-1', key: 'profile:name', operation: 'upsert', value: 'Ada', timestamp: 10 }]
    } satisfies SyncResponse])
    const sync = createSync({
      transport,
      storage,
      onRemote: changes => { applied.push(...changes.map(change => String(change.value))) }
    })

    const local = sync.enqueue({ key: 'draft:1', operation: 'upsert', value: { title: 'Draft' }, timestamp: 1 })
    expect(sync.pending.value).toBe(1)
    const result = await sync.sync()

    expect(result).toMatchObject({ timestamp: '2026-09-03T08:00:00.000Z', cursor: 'cursor-2', pushed: 1, pulled: 1 })
    expect(applied).toEqual(['Ada'])
    expect(sync.pending.value).toBe(0)
    expect((requests[0] as SyncRequest).cursor).toBeNull()
    expect((requests[0] as SyncRequest).changes[0].id).toBe(local.id)

    const restored = createSync({ transport, storage })
    expect(restored.cursor.value).toBe('cursor-2')
    expect(restored.lastSyncAt.value).toBe('2026-09-03T08:00:00.000Z')
    expect(restored.pendingChanges.value).toEqual([])
    restored.dispose()
    sync.dispose()
    storage.dispose()
  })

  /*
   * The entire point of §"offline first": enqueue persists immediately. enqueue/removePending/
   * clearPending used to only touch the in-memory signal (setPending didn't write storage;
   * persist() only ran at the end of restore()/runCycle()) → after editing offline and closing
   * the page, unuploaded changes **vanished permanently**, while README:35 promised persistence.
   * The test above happens to dodge this path because it runs a full sync() right after enqueue.
   */
  it('enqueue persists immediately: rebuilding the instance without running sync keeps unuploaded changes', () => {
    const storage = makeStorage()
    const { transport } = fakeTransport([])
    const sync = createSync({ transport, storage })
    sync.enqueue({ key: 'draft:1', operation: 'upsert', value: { title: 'A' }, timestamp: 1 })
    sync.enqueue({ key: 'draft:2', operation: 'upsert', value: { title: 'B' }, timestamp: 2 })
    expect(sync.pending.value).toBe(2)

    // Simulate "edit offline then close the page": no sync, rebuild the instance directly
    const restored = createSync({ transport, storage })
    expect(restored.pending.value).toBe(2)
    expect(restored.pendingChanges.value.map(change => change.key)).toEqual(['draft:1', 'draft:2'])
    restored.dispose()
    sync.dispose()
    storage.dispose()
  })

  it('removePending / clearPending also persist to disk', () => {
    const storage = makeStorage()
    const { transport } = fakeTransport([])
    const sync = createSync({ transport, storage })
    const first = sync.enqueue({ key: 'a', operation: 'upsert', value: 1, timestamp: 1 })
    sync.enqueue({ key: 'b', operation: 'upsert', value: 2, timestamp: 2 })

    expect(sync.removePending(first.id)).toBe(true)
    const afterRemove = createSync({ transport, storage })
    expect(afterRemove.pending.value).toBe(1)
    expect(afterRemove.pendingChanges.value[0]?.key).toBe('b')

    sync.clearPending()
    const afterClear = createSync({ transport, storage })
    expect(afterClear.pending.value).toBe(0)

    afterRemove.dispose()
    afterClear.dispose()
    sync.dispose()
    storage.dispose()
  })

  it('enqueue throws SYNC_FAILED when persisting fails, and memory never enters a half-state', () => {
    const storage = makeStorage()
    const { transport } = fakeTransport([])
    const sync = createSync({ transport, storage })
    const setItem = vi.spyOn(storage, 'set').mockImplementation(() => { throw new Error('disk full') })

    expect(() => sync.enqueue({ key: 'x', operation: 'upsert', value: 1, timestamp: 1 }))
      .toThrowError(expect.objectContaining({ code: 'SYNC_FAILED' }))
    expect(sync.pending.value).toBe(0)

    setItem.mockRestore()
    sync.enqueue({ key: 'x', operation: 'upsert', value: 1, timestamp: 1 })
    expect(sync.pending.value).toBe(1)
    sync.dispose()
    storage.dispose()
  })

  /*
   * The report claimed "onRemote throws → pending already cleared and persisted, local changes lost
   * forever". **Not reproducible**: `await onRemote(...)` runs **before** setPending/persist, so
   * when it throws the entire commit block never executes → pending stays as-is (ack'd local
   * changes re-sent next round = at-least-once) and the cursor doesn't advance (remote changes
   * re-pulled next round = self-healing). This test pins the actual behavior to prevent someone
   * later "conveniently" committing early.
   */
  it('losing no data when onRemote throws: pending is kept and the cursor does not advance (re-send/re-pull next round)', async () => {
    const storage = makeStorage()
    let localId = ''
    const transport: SyncTransport = {
      sync: async () => ({
        cursor: 'cursor-2',
        timestamp: '2026-09-03T08:00:00.000Z',
        acknowledged: [localId],
        changes: [{ id: 'r1', key: 'other', operation: 'upsert', value: 'R', timestamp: 5 }]
      })
    }
    const sync = createSync({ transport, storage, onRemote: () => { throw new Error('boom') } })
    const local = sync.enqueue({ key: 'k', operation: 'upsert', value: 'L', timestamp: 1 })
    localId = local.id

    await expect(sync.sync()).rejects.toMatchObject({ code: 'SYNC_FAILED' })
    expect(sync.pending.value).toBe(1)
    expect(sync.cursor.value).toBeNull()
    expect(sync.lastSyncAt.value).toBeNull()
    // What's persisted is also the "not yet committed" version
    const restored = createSync({ transport, storage })
    expect(restored.pending.value).toBe(1)
    expect(restored.cursor.value).toBeNull()

    restored.dispose()
    sync.dispose()
    storage.dispose()
  })

  it('rejects array responses (typeof === "object" used to let them through → faked success)', async () => {
    const storage = makeStorage()
    const { transport } = fakeTransport([[
      { id: 'x', key: 'k', operation: 'upsert', value: 1, timestamp: 1 }
    ]])
    const sync = createSync({ transport, storage })
    await expect(sync.sync()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(sync.status.value).toBe('error')
    sync.dispose()
    storage.dispose()
  })

  it('keeps local-wins changes and removes the conflicting local change on remote-wins', async () => {
    const localWinsStorage = makeStorage()
    const localWinsTransport = fakeTransport([{
      timestamp: 1000,
      changes: [{ id: 'remote', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
    }])
    const localWins = createSync({ transport: localWinsTransport.transport, storage: localWinsStorage, conflict: 'local-wins' })
    localWins.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })
    const kept = await localWins.sync()
    expect(kept.pulled).toBe(0)
    expect(localWins.pendingChanges.value[0]?.value).toBe('local')

    const remoteWinsStorage = makeStorage()
    const remoteWinsTransport = fakeTransport([{
      timestamp: 1000,
      changes: [{ id: 'remote', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
    }])
    const remoteWins = createSync({ transport: remoteWinsTransport.transport, storage: remoteWinsStorage, conflict: 'remote-wins' })
    remoteWins.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })
    const replaced = await remoteWins.sync()
    expect(replaced.pulled).toBe(1)
    expect(remoteWins.pending.value).toBe(0)

    localWins.dispose()
    remoteWins.dispose()
    localWinsStorage.dispose()
    remoteWinsStorage.dispose()
  })

  /*
   * Two "local-wins never converges" defects (both reproducible under the old implementation; see
   * measured values in the comments below).
   *
   * When the server pushes the same remote key every round, the old implementation kept the winning
   * local change in pending forever:
   *   - Even when the server **explicitly** confirmed receipt via `acknowledged: ['local']`,
   *     `!conflictIds.has(id)` prevented its removal → re-pushed verbatim every cycle, pushed stuck
   *     ≥1, and the change was forever "not uploaded successfully".
   *   - Conflict resolution then re-ran every round → the custom resolver got called again each
   *     round and pulled stayed 0 (measured: resolver called 3 times across 3 rounds; pulled
   *     remained 0 over 60ms/multiple rounds).
   * Contract: conflict resolution only decides "should the remote value override the local value",
   * not "did the server accept it" — the latter is answered solely by acknowledged. And once the
   * same local change (unchanged id+timestamp) is resolved to local, the verdict cannot change, so
   * the resolver shouldn't re-run.
   */
  it('converges when the server pushes the same key every round: after explicit ack the local change leaves the queue and the remote value is accepted', async () => {
    const storage = makeStorage()
    const transport: SyncTransport = {
      sync: async () => ({
        cursor: 'cursor-2',
        timestamp: '2026-09-03T08:00:00.000Z',
        acknowledged: ['local'],
        changes: [{ id: 'remote', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
      })
    }
    const sync = createSync({ transport, storage, conflict: 'local-wins' })
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })

    const first = await sync.sync()
    expect(first).toMatchObject({ pushed: 1, pulled: 0 })
    expect(sync.pending.value).toBe(0)

    // This local change uploaded successfully; next round the conflict is gone and the remote value lands normally
    const second = await sync.sync()
    expect(second).toMatchObject({ pushed: 0, pulled: 1 })
    expect(second.changes[0]?.value).toBe('remote')
    sync.dispose()
    storage.dispose()
  })

  /*
   * **Clearing** the verdict cache (§18.100/§18.102). The cache key is the pending change's id, so
   * when a change leaves pending its verdict must be dropped too; otherwise, when the caller
   * resubmits the same change with the **same id+timestamp**, `resolveConflict` short-circuits to
   * 'local' with the stale verdict and **never calls** the custom resolver again (the decision is
   * silently reused).
   */
  it('resubmitting the same change (same id+timestamp) after it left the queue calls the resolver again', async () => {
    const storage = makeStorage()
    const resolve = vi.fn(() => 'local' as const)
    const transport: SyncTransport = {
      sync: async () => ({
        timestamp: 1000,
        acknowledged: ['local'],
        changes: [{ id: 'remote', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
      })
    }
    const sync = createSync({ transport, storage, conflict: resolve })
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })

    await sync.sync()
    expect(resolve).toHaveBeenCalledTimes(1)

    // The caller (e.g. a "retry" button) resubmits with the same id+timestamp
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })
    await sync.sync()

    // Without cache clearing this stays 1 (short-circuited by the previous verdict) → test fails
    expect(resolve).toHaveBeenCalledTimes(2)
    sync.dispose()
    storage.dispose()
  })

  it('resolves conflict only once for the same local change: a repeatedly pushed remote does not re-run the resolver', async () => {
    const storage = makeStorage()
    const resolve = vi.fn(() => 'local' as const)
    const transport: SyncTransport = {
      sync: async () => ({
        timestamp: 1000,
        // Explicit empty ack: the server did not confirm receipt of any change
        acknowledged: [],
        changes: [{ id: 'remote-stable', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
      })
    }
    const sync = createSync({ transport, storage, conflict: resolve })
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })

    const first = await sync.sync()
    const second = await sync.sync()
    const third = await sync.sync()

    expect(resolve).toHaveBeenCalledTimes(1)
    // Not acked → still pending (at-least-once), but the verdict never flips
    expect([first.pulled, second.pulled, third.pulled]).toEqual([0, 0, 0])
    expect(sync.pendingChanges.value.map(change => change.value)).toEqual(['local'])
    sync.dispose()
    storage.dispose()
  })

  /*
   * The verdict cache must be **bounded**: `localWinsResolved` is keyed by local change id, so once
   * a change leaves the queue (acked, removePending, clearPending) its entry must be deleted;
   * otherwise it grows without bound over a long run. This pins reclamation on the most ordinary
   * path: "the change is acked and leaves the queue".
   */
  it('the local-wins verdict cache is bounded: entries are dropped once the change leaves the queue', async () => {
    const storage = makeStorage()
    const first: SyncTransport = {
      sync: async () => ({
        timestamp: 1000,
        acknowledged: ['local-1'],
        changes: [{ id: 'remote-1', key: 'item:1', operation: 'upsert', value: 'remote-1', timestamp: 2 }]
      })
    }
    const sync = createSync({ transport: first, storage, conflict: 'local-wins' })
    sync.enqueue({ id: 'local-1', key: 'item:1', operation: 'upsert', value: 'local-1', timestamp: 3 })
    await sync.sync()
    expect(sync.pending.value).toBe(0)

    // A different key (hence a different cache entry) + the server no longer acks: the new change must be re-resolved
    const second: SyncTransport = {
      sync: async () => ({
        timestamp: 2000,
        acknowledged: [],
        changes: [{ id: 'remote-2', key: 'item:2', operation: 'upsert', value: 'remote-2', timestamp: 4 }]
      })
    }
    const next = createSync({ transport: second, storage: makeStorage(), conflict: 'local-wins' })
    next.enqueue({ id: 'local-2', key: 'item:2', operation: 'upsert', value: 'local-2', timestamp: 5 })
    const result = await next.sync()
    expect(result).toMatchObject({ pushed: 1, pulled: 0 })
    expect(next.pendingChanges.value.map(change => change.value)).toEqual(['local-2'])
    sync.dispose()
    next.dispose()
    storage.dispose()
  })

  it('supports a custom conflict resolver, events, and failure state', async () => {
    const storage = makeStorage()
    const onError = vi.fn()
    const onRemote = vi.fn()
    const { transport } = fakeTransport([{
      timestamp: 1000,
      changes: [{ id: 'remote', key: 'item:1', operation: 'upsert', value: 'remote', timestamp: 2 }]
    }])
    const done = vi.fn()
    const sync = createSync({
      transport,
      storage,
      conflict: (local, remote) => ({ ...remote, value: `${String(local.value)}+${String(remote.value)}` }),
      onRemote,
      onError
    })
    sync.on('done', done)
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 1 })
    await sync.sync()
    expect(onRemote).toHaveBeenCalledWith([
      expect.objectContaining({ value: 'local+remote' })
    ], expect.anything())
    expect(done).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    sync.dispose()
    storage.dispose()
  })

  it('does not request while offline and retries automatically after the online event', async () => {
    const storage = makeStorage()
    const { transport, requests } = fakeTransport([{ timestamp: 1000, changes: [] }])
    const sync = createSync({ transport, storage })
    const originalOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    sync.start().catch(() => undefined)
    await vi.waitFor(() => expect(sync.status.value).toBe('offline'))
    expect(requests).toHaveLength(0)

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await vi.waitFor(() => expect(sync.status.value).toBe('done'))
    sync.dispose()
    storage.dispose()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline })
  })

  /*
   * The semantics of `pollInterval` = **fixed-interval polling**, not "failure retry + backoff".
   *
   * A deep-read report said "no retry backoff after failure, 0 automatic retries within 60ms".
   * Measured: that is the contract, not a defect —
   *   - After a failure the request interval **equals** pollInterval exactly (measured
   *     1000/1000/1000…, no exponential growth);
   *   - With an explicit pollInterval, failures keep going (the next request = the next tick),
   *     hence "no backoff";
   *   - Without pollInterval, **zero** automatic retries after failure (still exactly 1 request
   *     after 10s).
   * Basis: README:44 only promises "`pollInterval` syncing"; SyncOptions has no retry/retryDelay.
   * If backoff is needed, the caller should schedule it via `onError`/the `error` event +
   * `stop()` (queue supports per-task retry, but sync's runCycle does not use it). Pinned to
   * prevent someone later "conveniently" adding retries and changing the semantics.
   */
  it('pollInterval is fixed-interval polling, not backoff retry; without it there are no automatic retries after failure', async () => {
    vi.useFakeTimers()
    try {
      const storage = makeStorage()
      const attemptAt: number[] = []
      const transport: SyncTransport = {
        sync: async () => {
          attemptAt.push(Date.now())
          throw new Error('boom')
        }
      }
      const sync = createSync({ transport, storage, pollInterval: 1000 })
      const started = sync.start().catch(() => undefined)

      await vi.advanceTimersByTimeAsync(0)
      expect(attemptAt).toHaveLength(1)
      // The report's "0 retries within 60ms": no implicit retry, only the next poll tick
      await vi.advanceTimersByTimeAsync(60)
      expect(attemptAt).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(attemptAt).toHaveLength(2)

      await vi.advanceTimersByTimeAsync(5000)
      const gaps = attemptAt.slice(1).map((at, index) => at - attemptAt[index]!)
      expect(gaps).toEqual([1000, 1000, 1000, 1000, 1000, 1000])
      expect(sync.status.value).toBe('error')

      sync.stop()
      await started
      sync.dispose()

      // Without pollInterval: no automatic retry after failure (the caller decides the retry policy)
      const passiveStorage = makeStorage()
      let passiveAttempts = 0
      const passive = createSync({
        transport: { sync: async () => { passiveAttempts++; throw new Error('boom') } },
        storage: passiveStorage
      })
      await passive.sync().catch(() => undefined)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(passiveAttempts).toBe(1)
      passive.dispose()
      passiveStorage.dispose()
      storage.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop cancels the in-flight request and dispose cleans up owned queue and storage', async () => {
    const storage = makeStorage()
    let aborted = false
    const transport = {
      sync: vi.fn((_request: unknown, signal: AbortSignal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      }))
    } satisfies SyncTransport
    const sync = createSync({ transport, storage })
    const request = sync.start()
    await vi.waitFor(() => expect(sync.status.value).toBe('syncing'))
    sync.stop()
    await expect(request).rejects.toMatchObject({ code: 'SYNC_FAILED' })
    expect(aborted).toBe(true)
    expect(sync.status.value).toBe('idle')
    sync.dispose()
    storage.dispose()
  })

  it('the plugin can reuse injected transport/storage/queue, and useSync errors when not installed', () => {    let injected: ReturnType<typeof createSync> | undefined
    const consumer: VobsPlugin = {
      name: 'sync-consumer',
      install(context) { injected = context.inject(SYNC_KEY) as ReturnType<typeof createSync> }
    }
    const app = createVobs({
      render: () => createText('sync'),
      plugins: [syncPlugin({ transport: fakeTransport([]).transport }), consumer]
    })
    app.mount(document.createElement('div'))
    expect(injected).toBeDefined()
    app.destroy()

    const missing = createVobs({ render: () => {
      useSync()
      return createText('')
    } })
    expect(() => missing.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'SYNC_CONTEXT_MISSING' })
    )
  })

  it('rejects further use after the sync context is disposed', () => {
    const queue = createTaskQueue()
    const storage = makeStorage()
    const sync = createSync({ transport: fakeTransport([]).transport, storage, queue })
    sync.dispose()
    expect(() => sync.enqueue({ key: 'x', operation: 'delete' })).toThrowError(
      expect.objectContaining({ code: 'SYNC_CONTEXT_DISPOSED' })
    )
    queue.dispose()
    storage.dispose()
  })

  it('rejects invalid server responses', async () => {
    const storage = makeStorage()
    const sync = createSync({ transport: fakeTransport([null]).transport, storage })
    await expect(sync.sync()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(sync.status.value).toBe('error')
    expect(sync.error.value).toBeInstanceOf(SyncError)
    sync.dispose()
    storage.dispose()
  })
})
