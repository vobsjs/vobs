// @vitest-environment jsdom
/*
 * 同一个 id 在**任务已结束**之后应当可以再次使用。
 *
 * `add()` 的判重只看 `tasks.value.some(task => task.id === id)`，完全不看任务是否已结束；
 * 而 `tasks.value` 只在 `clear()` / `dispose()` 时清空 —— 正常完成的任务**永远留在数组里**。
 *
 * 于是这些都会无故抛 `已存在任务 <id>`：
 * - 用完再复用同一个（显式）id
 * - `idFactory` 生成可复用的 id（如按业务键：`upload:avatar`）
 *
 * 而且 `tasks.value` 只追加、长会话里无界增长。
 */
import { describe, expect, it } from 'vitest'
import { createTaskQueue } from './index'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('queue：已结束任务的 id 可以复用', () => {
  it('同一个显式 id 在任务完成后可以再次添加', async () => {
    const queue = createTaskQueue()
    const first = queue.add(async () => 'a', { id: 'reuse' })
    await first.promise
    await tick()

    // 修复前：抛 "Vobs Queue: 已存在任务 reuse"
    const second = queue.add(async () => 'b', { id: 'reuse' })
    await expect(second.promise).resolves.toBe('b')

    queue.dispose()
  })

  it('idFactory 生成可复用 id 时不因历史任务抛错', async () => {
    const queue = createTaskQueue({ idFactory: () => 'fixed-key' })
    await queue.add(async () => 1).promise
    await tick()
    await expect(queue.add(async () => 2).promise).resolves.toBe(2)
    queue.dispose()
  })

  it('同时**在飞**的同名 id 仍然判重（既有语义保留）', async () => {
    const queue = createTaskQueue()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = queue.add(async () => { await gate; return 1 }, { id: 'busy' })

    expect(() => queue.add(async () => 2, { id: 'busy' })).toThrow()
    release()
    await running.promise
    queue.dispose()
  })

  it('已结束任务被移出 tasks（长会话不再无界增长）', async () => {
    const queue = createTaskQueue()
    for (let i = 0; i < 5; i++) {
      await queue.add(async () => i).promise
      await tick()
    }
    // 修复前：这里会是 5（只追加、从不移除）
    expect(queue.tasks.value.length, '已结束的任务没有被移出 tasks').toBe(0)
    queue.dispose()
  })

  it('排队中 / 运行中的任务仍然留在 tasks 里', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = queue.add(async () => { await gate; return 1 })
    const waiting = queue.add(async () => 2)

    expect(queue.tasks.value.length, '在飞的任务不该被移出 tasks').toBe(2)

    release()
    await running.promise
    await waiting.promise
    await tick()
    expect(queue.tasks.value.length).toBe(0)
    queue.dispose()
  })

  it('统计量在结束后仍然正确（total 不会被移除动作搞坏）', async () => {
    const queue = createTaskQueue()
    await queue.add(async () => 1).promise
    await queue.add(async () => 2).promise
    await tick()
    expect(queue.completed.value).toBe(2)
    expect(queue.failed.value).toBe(0)
    // total = pending + processing + completed + failed = 0 + 0 + 2 + 0
    expect(queue.total.value).toBe(2)
    queue.dispose()
  })

  it('失败的任务同样被移出（不只有成功的）', async () => {
    const queue = createTaskQueue()
    await queue.add(async () => { throw new Error('boom') }).promise.catch(() => undefined)
    await tick()
    expect(queue.tasks.value.length, '失败任务没有被移出').toBe(0)
    expect(queue.failed.value).toBe(1)
    queue.dispose()
  })
})
