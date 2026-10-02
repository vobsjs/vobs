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

  it('插件可复用注入的 transport/storage/queue，未安装时 useSync 报错', () => {
    let injected: ReturnType<typeof createSync> | undefined
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
