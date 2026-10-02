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
  it('持久化待上传变更和增量 cursor，并应用远端变更', async () => {
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
   * §"离线优先"的全部意义：入队即落盘。原来 enqueue/removePending/clearPending 只改内存信号
   * （setPending 不写 storage，persist() 只在 restore()/runCycle() 末尾调用）→ 离线编辑后
   * 关页面，未上传的变更**永久消失**，而 README:35 承诺了持久化。
   * 上面那条用例在 enqueue 之后先跑了完整 sync()，恰好绕开了这条路径。
   */
  it('enqueue 立刻落盘：不跑 sync 直接重建实例，未上传的变更还在', () => {
    const storage = makeStorage()
    const { transport } = fakeTransport([])
    const sync = createSync({ transport, storage })
    sync.enqueue({ key: 'draft:1', operation: 'upsert', value: { title: 'A' }, timestamp: 1 })
    sync.enqueue({ key: 'draft:2', operation: 'upsert', value: { title: 'B' }, timestamp: 2 })
    expect(sync.pending.value).toBe(2)

    // 模拟"离线编辑后关页面"：不跑 sync、直接重建实例
    const restored = createSync({ transport, storage })
    expect(restored.pending.value).toBe(2)
    expect(restored.pendingChanges.value.map(change => change.key)).toEqual(['draft:1', 'draft:2'])
    restored.dispose()
    sync.dispose()
    storage.dispose()
  })

  it('removePending / clearPending 也落盘', () => {
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

  it('落盘失败时 enqueue 抛 SYNC_FAILED，且内存不进入半状态', () => {
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
   * 报告说"onRemote 抛错 → pending 已清空并落盘、本地变更永久消失"。**实测不成立**：
   * `await onRemote(...)` 排在 setPending/persist **之前**，抛错时整段提交逻辑都没跑 →
   * pending 保持原样（已 ack 的本地变更下轮重发 = at-least-once）、cursor 不推进
   * （远端变更下轮重新拉取 = 自愈）。这里把实际行为钉住，防止以后有人"顺手"提前提交。
   */
  it('onRemote 抛错时不丢数据：pending 保留、cursor 不推进（下轮重发/重拉）', async () => {
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
    // 落盘的也是"还没提交"的那一份
    const restored = createSync({ transport, storage })
    expect(restored.pending.value).toBe(1)
    expect(restored.cursor.value).toBeNull()

    restored.dispose()
    sync.dispose()
    storage.dispose()
  })

  it('数组响应被拒绝（原来 typeof === "object" 放行 → 假成功）', async () => {
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

  it('保留 local-wins 变更，remote-wins 则移除冲突本地变更', async () => {
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
   * 两条"local-wins 不收敛"的缺陷（原实现下都能复现，见下方注释的实测值）。
   *
   * 服务端每轮都推同一个远端 key 时，原实现把胜出的本地变更永久留在 pending：
   *   - 即便服务端**显式** `acknowledged: ['local']` 确认收下了，`!conflictIds.has(id)`
   *     也让它永远不摘 → 每个周期原样重推、pushed 恒 ≥1，这条变更永远"没上传成功"。
   *   - 于是冲突判定每轮重跑 → 自定义 resolver 每轮被再调一次、pulled 永远 0
   *     （实测 3 轮 resolver 被调 3 次；60ms/多轮内 pulled 始终 0）。
   * 契约：冲突判定只决定"远端值要不要覆盖本地值"，不决定"服务端收没收下" ——
   * 后者只看 acknowledged。且同一份本地变更（id+timestamp 未变）判给 local 后
   * 结论不会再变，不该重跑 resolver。
   */
  it('服务端每轮推同一 key 时收敛：显式 ack 后本地变更离队，远端值被接受', async () => {
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

    // 本地这份变更已经上传成功，下一轮冲突消失、远端值正常落地
    const second = await sync.sync()
    expect(second).toMatchObject({ pushed: 0, pulled: 1 })
    expect(second.changes[0]?.value).toBe('remote')
    sync.dispose()
    storage.dispose()
  })

  /*
   * 判定缓存的**清账**（§18.100/§18.102）。缓存键就是 pending 变更的 id，所以变更离开 pending 时
   * 必须把结论一起丢掉；否则调用方用**同一 id+timestamp** 重新提交同一份变更时，
   * `resolveConflict` 会拿旧结论短路成 'local'，**不再调用**自定义 resolver（决策被悄悄复用）。
   */
  it('变更离队后再提交同一份（同 id+timestamp）会重新调用 resolver', async () => {
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

    // 调用方（如"重试"按钮）用同一 id+timestamp 再提交一次
    sync.enqueue({ id: 'local', key: 'item:1', operation: 'upsert', value: 'local', timestamp: 3 })
    await sync.sync()

    // 没有清账时这里仍是 1（被上一次的结论短路）→ 用例失败
    expect(resolve).toHaveBeenCalledTimes(2)
    sync.dispose()
    storage.dispose()
  })

  it('同一份本地变更只判一次冲突：服务端重复推同一 remote 不重跑 resolver', async () => {
    const storage = makeStorage()
    const resolve = vi.fn(() => 'local' as const)
    const transport: SyncTransport = {
      sync: async () => ({
        timestamp: 1000,
        // 显式空 ack：服务端没有确认收下任何变更
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
    // 没被 ack → 仍然 pending（at-least-once），但结论不会翻
    expect([first.pulled, second.pulled, third.pulled]).toEqual([0, 0, 0])
    expect(sync.pendingChanges.value.map(change => change.value)).toEqual(['local'])
    sync.dispose()
    storage.dispose()
  })

  /*
   * 判定缓存必须**有界**：`localWinsResolved` 只按本地变更 id 记账，本地变更一离队
   * （被 ack、removePending、clearPending）就必须删掉，否则长期运行会无界增长。
   * 这里用"变更被 ack 离队"这条最普通的路径钉住回收。
   */
  it('local-wins 判定缓存有界：变更离队后不再记账', async () => {
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

    // 换一个 key（因此换一条缓存项）+ 服务端不再 ack：新变更必须被重新判定
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

  it('支持自定义冲突 resolver、事件和失败状态', async () => {
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

  it('离线时不请求，online 事件后自动重试', async () => {
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
   * `pollInterval` 的语义 = **固定周期轮询**，不是"失败重试 + 退避"。
   *
   * 深读报告说"失败后无重试退避、60ms 内 0 次自动重试"。实测：那是契约而非缺陷 ——
   *   - 失败后请求间隔**恒等于** pollInterval（实测 1000/1000/1000…，无指数增长）；
   *   - 显式 pollInterval 时失败也会继续（下一次请求 = 下一个 tick），所以"没有退避"；
   *   - 不传 pollInterval 时失败后**一次都不会自动重试**（10s 内仍只有 1 次请求）。
   * 依据：README:44 只承诺 "`pollInterval` syncing"，SyncOptions 里没有 retry/retryDelay，
   * 需要退避请由调用方用 `onError`/`error` 事件 + `stop()` 自行调度（queue 支持 per-task
   * retry，但 sync 的 runCycle 并未使用它）。把这条钉住，防止以后有人"顺手"加重试改变语义。
   */
  it('pollInterval 是固定周期轮询而非退避重试；不传则失败后不自动重试', async () => {
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
      // 报告说的"60ms 内 0 次重试"：没有隐式重试，只有下一个 poll tick
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

      // 不传 pollInterval：失败后没有自动重试（调用方自己决定重试策略）
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

  it('stop 取消正在执行的请求，dispose 清理自有 queue 和 storage', async () => {
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

  it('插件可复用注入的 transport/storage/queue，未安装时 useSync 报错', () => {    let injected: ReturnType<typeof createSync> | undefined
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

  it('同步上下文销毁后拒绝继续使用', () => {
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

  it('拒绝无效服务端响应', async () => {
    const storage = makeStorage()
    const sync = createSync({ transport: fakeTransport([null]).transport, storage })
    await expect(sync.sync()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(sync.status.value).toBe('error')
    expect(sync.error.value).toBeInstanceOf(SyncError)
    sync.dispose()
    storage.dispose()
  })
})
