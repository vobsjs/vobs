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
