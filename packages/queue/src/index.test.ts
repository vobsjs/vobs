import { describe, expect, it, vi } from 'vitest'
import { createText, createVobs } from '@vobs/vobs'
import {
  QUEUE_KEY,
  QueueError,
  createTaskQueue,
  queuePlugin,
  useQueue
} from './index'

describe('@vobs/queue', () => {
  it('按优先级调度任务，并暴露响应式统计', async () => {
    const calls: string[] = []
    const queue = createTaskQueue({ concurrency: 1 })
    const first = queue.add(async () => {
      calls.push('normal-1')
      return 1
    })
    const high = queue.add(async () => {
      calls.push('high')
      return 2
    }, { priority: 'high' })
    const last = queue.add(async () => {
      calls.push('normal-2')
      return 3
    })

    await expect(first.promise).resolves.toBe(1)
    await expect(high.promise).resolves.toBe(2)
    await expect(last.promise).resolves.toBe(3)
    expect(calls).toEqual(['normal-1', 'high', 'normal-2'])
    expect(queue.pending.value).toBe(0)
    expect(queue.processing.value).toBe(0)
    expect(queue.completed.value).toBe(3)
    expect(queue.failed.value).toBe(0)
    expect(queue.total.value).toBe(3)
    queue.dispose()
  })

  it('限制并发，并在暂停期间不启动新任务', async () => {
    const resolvers: Array<() => void> = []
    let running = 0
    let maxRunning = 0
    const queue = createTaskQueue({ concurrent: 2 })
    queue.pause()
    const tasks = [1, 2, 3].map(id => queue.add(async () => new Promise(resolve => {
      running++
      maxRunning = Math.max(maxRunning, running)
      resolvers.push(() => {
        running--
        resolve(id)
      })
    })))

    expect(queue.paused.value).toBe(true)
    expect(queue.pending.value).toBe(3)
    expect(resolvers).toHaveLength(0)
    queue.resume()
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers.shift()?.()
    resolvers.shift()?.()
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    resolvers.shift()?.()
    await Promise.all(tasks.map(task => task.promise))
    expect(maxRunning).toBe(2)
    queue.dispose()
  })

  it('失败后按 retry 和 retryDelay 重试，最终拒绝并通知错误', async () => {
    let attempts = 0
    const onError = vi.fn()
    const queue = createTaskQueue({ onError })
    const task = queue.add(async () => {
      attempts++
      throw new Error(`failure-${attempts}`)
    }, { retry: 2, retryDelay: 0 })

    await expect(task.promise).rejects.toMatchObject({ code: 'QUEUE_TASK_FAILED' })
    expect(attempts).toBe(3)
    expect(task.attempt.value).toBe(3)
    expect(task.status.value).toBe('error')
    expect(queue.failed.value).toBe(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'QUEUE_TASK_FAILED' }), task)
    queue.dispose()
  })

  it('取消排队和运行中的任务，并允许失败任务重新提交', async () => {
    let resolveRunning: (() => void) | undefined
    let aborted = false
    const queue = createTaskQueue({ concurrency: 1 })
    const running = queue.add(signal => new Promise(resolve => {
      resolveRunning = () => resolve('done')
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
    }))
    const pending = queue.add(() => 'pending')
    await vi.waitFor(() => expect(running.status.value).toBe('running'))
    pending.cancel()
    await expect(pending.promise).rejects.toMatchObject({ code: 'QUEUE_TASK_CANCELLED' })
    running.cancel()
    await expect(running.promise).rejects.toMatchObject({ code: 'QUEUE_TASK_CANCELLED' })
    expect(aborted).toBe(true)
    resolveRunning?.()

    let shouldFail = true
    const recoverable = queue.add(() => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('try again')
      }
      return 'recovered'
    })
    await expect(recoverable.promise).rejects.toBeInstanceOf(QueueError)
    await expect(recoverable.retry()).resolves.toBe('recovered')
    expect(recoverable.status.value).toBe('success')
    queue.dispose()
  })

  it('clear 只取消排队任务，插件注入并在应用销毁后清理上下文', async () => {
    let injected: ReturnType<typeof createTaskQueue> | undefined
    const app = createVobs({
      render: () => createText('queue'),
      plugins: [
        queuePlugin({ concurrency: 1 }),
        { name: 'consumer', install(context) { injected = context.inject(QUEUE_KEY) as ReturnType<typeof createTaskQueue> } }
      ]
    })
    const first = injected!.add(() => new Promise(() => undefined))
    const second = injected!.add(() => 'never')
    void first.promise.catch(() => undefined)
    await vi.waitFor(() => expect(first.status.value).toBe('running'))
    injected!.clear()
    await expect(second.promise).rejects.toMatchObject({ code: 'QUEUE_TASK_CANCELLED' })
    app.destroy()
    expect(() => injected!.add(() => 'later')).toThrowError(expect.objectContaining({ code: 'QUEUE_CONTEXT_DISPOSED' }))
  })

  /*
   * 报告 §2「任务 id 永久唯一、无淘汰、没有 remove()」判为**契约**，不是缺陷。证据三条：
   *
   *  - 默认 id 来自只增不减的计数器（index.ts:114 `let nextId = 0`、index.ts:131 `task-${++nextId}`），
   *    探针连跑 500 个任务得到 task-1..task-500，一次都没撞 —— 报告说的「长会话必然撞 id」
   *    只对**调用方自带** `id`/`idFactory` 成立（index.ts:131 的 `taskOptions.id ??` 优先级）。
   *  - 公开面没有 remove/delete：接口 index.ts:42-55、实现 index.ts:117-183 只有
   *    add/pause/resume/clear/dispose；`tasks.value` 只追加（index.ts:140），
   *    `clear()` 只取消排队任务（index.ts:160-165），只有 `dispose()` 清空
   *    `tasks`/`ownedTasks`（index.ts:172-174）。已结束任务在 dispose 前一直被强引用
   *    （探针：505 个已 success 的任务全部留在 `tasks.value` 里，堆差 +2.77MB）。
   *  - 已结束任务的 id 不能复用：去重检查 index.ts:135-137 抛 `INVALID_QUEUE_OPTIONS`，
   *    而它查的正是只追加的 `tasks.value`。
   *
   * 为什么**不**做 id 复用、也**不**加 `remove(id)`（写清楚，免得后人当缺陷顺手补）：
   *
   *  1. `tasks` 是订阅者共享的 id 空间。同一 id 前后指向两个不同任务对象时，按 id 做的
   *     订阅/持久化（「upload-1 的结果」）就串味了：旧任务与新任务同时在 `tasks` 里，
   *     `tasks.find(t => t.id === 'upload-1')` 谁也说不清指哪一个。
   *  2. 复用 id 只有两条路：允许重复（= 上面的歧义）或静默顶掉旧任务 —— 后者等于让
   *     `add()` 悄悄撤销一个调用方还持有引用的任务，破坏 `cancel()/retry()/promise` 的所有权。
   *  3. 「释放任务」在本模块是**整体**语义：`dispose()` 会 cancel + abort + 销毁统计信号
   *     （index.ts:167-182），那才是回收路径。补一个只允许移除已终结任务的 `remove(id)`，
   *     等于新增一个与 `tasks`/`total` 订阅者语义打架的面，doc 与测试都得跟着长。
   *
   * 所以「已结束任务留到 dispose」是刻意选择：代价是内存保留，替代路径是短生命周期队列
   * 或 `dispose()` 后重建。本用例把这三件事钉住，动了任何一条都会红。
   */
  it('任务 id 单调唯一且永不复用，摘除任务只有 dispose 一条路', async () => {
    const queue = createTaskQueue({ concurrency: 2 })
    const settled = [queue.add(() => 1), queue.add(() => 2), queue.add(() => 3)]
    await Promise.all(settled.map(task => task.promise))

    // 1) 默认 id 单调递增、互不相同（计数器不复用）
    expect(settled.map(task => task.id)).toEqual(['task-1', 'task-2', 'task-3'])

    // 2) 已结束任务不会被摘掉：公开列表与 total 都还留着，而且是同一个对象
    expect(queue.tasks.value).toHaveLength(3)
    expect(queue.total.value).toBe(3)
    expect(queue.completed.value).toBe(3)
    expect(queue.tasks.value[0]).toBe(settled[0])
    expect(settled[0]!.status.value).toBe('success')

    // 3) 公开 API 没有移除单个任务的能力，只有整体 clear()/dispose()
    expect('remove' in queue).toBe(false)
    expect('delete' in queue).toBe(false)

    // 4) 完成过的显式 id 不能复用 —— 去重检查查的是只追加的 tasks
    const upload = queue.add(() => 'uploaded', { id: 'upload-1' })
    await upload.promise
    expect(() => queue.add(() => 'again', { id: 'upload-1' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUEUE_OPTIONS' })
    )

    // 5) clear() 只取消排队任务：已结束任务仍在 tasks 里，id 也不回收（下一个是 task-4）
    queue.clear()
    expect(queue.tasks.value).toHaveLength(4)
    expect(queue.tasks.value[0]).toBe(settled[0])
    const afterClear = queue.add(() => 'after-clear')
    expect(afterClear.id).toBe('task-4')
    await afterClear.promise

    // 6) 唯一能摘除任务的是 dispose()：tasks 被清空
    queue.dispose()
    expect(queue.tasks.value).toHaveLength(0)

    // 7) 长跑：计数器只增不减（本用例钉的是契约，不是「报告说的会撞 id」）
    const long = createTaskQueue({ concurrency: 8 })
    const batch = Array.from({ length: 64 }, () => long.add(() => 'ok'))
    await Promise.all(batch.map(task => task.promise))
    const ids = batch.map(task => task.id)
    expect(new Set(ids).size).toBe(64)
    expect(ids[0]).toBe('task-1')
    expect(ids[63]).toBe('task-64')
    expect(long.tasks.value).toHaveLength(64)
    expect(long.total.value).toBe(64)
    long.dispose()
    expect(long.tasks.value).toHaveLength(0)
  })

  /*
   * 取消/清空/销毁都会 reject 任务 promise（`:232`/`:160`/`:170`）。调用方完全可能只关心
   * `add()` 的返回值、从没碰过 `.promise` —— 那在 Node 里就是**进程级 unhandledRejection**：
   * 清理阶段把进程带走，而 line 129 那条 `void first.promise.catch(...)` 就是这个约束的证据
   * （README 从没写过）。
   */
  it('clear()/dispose() 取消未完成任务不产生进程级 unhandledRejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const queue = createTaskQueue({ concurrency: 1 })
      const running = queue.add(() => new Promise(() => undefined))
      queue.add(() => 'queued')
      await vi.waitFor(() => expect(running.status.value).toBe('running'))

      queue.clear()   // 取消"排队"的那个：它的 promise 没人接
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
      expect(running.status.value).toBe('running')

      queue.dispose() // 取消"运行中"的那个：同样没人接
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  /*
   * dispose 之后，**在途**任务的收尾仍会走到 refreshStats()：原来会往已销毁的
   * pending/processing/completed/failed/total 写值 → 每条信号刷一条
   * `[vobs] 写入已 dispose 的 state` 告警（探针实测 5 条，与报告一致）。
   *
   * ⚠️ 这条用例必须**等够微任务**：告警发生在 in-flight 任务结算之后的好几跳里，
   * 只推 2 轮看不到（我第一版就是这样，误判"守卫无效"并把改动回退了）。
   */
  it('dispose 后在途任务的收尾不再往已销毁的统计信号写值', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const queue = createTaskQueue({ concurrency: 1 })
      let release: ((value: string) => void) | undefined
      const task = queue.add(() => new Promise<string>(resolve => { release = resolve }))
      await vi.waitFor(() => expect(task.status.value).toBe('running'))

      queue.dispose()
      release?.('late')
      for (let round = 0; round < 6; round += 1) await Promise.resolve()

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  /*
   * `drain()` 由 `add()` 同步调用 → 原来 `task.fn(...)` 在 `add()` 返回**之前**就跑了，
   * 紧接着 `cancel()` 根本来不及：副作用已经发生，而状态却报 cancelled、result 为 null
   * （报告实测 ran=true / status=cancelled）。起步延后一跳后，"add 完立刻 cancel" 能真正阻止执行。
   */
  it('add() 之后立刻 cancel() 能让任务根本不执行', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    let ran = false
    const task = queue.add(() => {
      ran = true
      return 'done'
    })

    task.cancel()
    await expect(task.promise).rejects.toMatchObject({ code: 'QUEUE_TASK_CANCELLED' })
    for (let round = 0; round < 3; round += 1) await Promise.resolve()

    expect(ran).toBe(false)
    expect(task.status.value).toBe('cancelled')
    queue.dispose()
  })

  it('未安装插件时 useQueue 给出明确错误', () => {
    const app = createVobs({ render: () => {
      useQueue()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'QUEUE_CONTEXT_MISSING' })
    )
  })
})
