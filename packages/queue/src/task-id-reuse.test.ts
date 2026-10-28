// @vitest-environment jsdom
/*
 * The same id should be usable again **after a task has finished**.
 *
 * `add()`'s deduplication only checked `tasks.value.some(task => task.id === id)`, with no regard
 * for whether the task had finished; and `tasks.value` was only emptied by `clear()` /
 * `dispose()` — normally completed tasks **stayed in the array forever**.
 *
 * So all of these spuriously threw `task <id> already exists`:
 * - reusing the same (explicit) id after use
 * - `idFactory` generating reusable ids (e.g. per business key: `upload:avatar`)
 *
 * And `tasks.value` was append-only, growing without bound in long sessions.
 */
import { describe, expect, it } from 'vitest'
import { createTaskQueue } from './index'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('queue: finished tasks allow id reuse', () => {
  it('the same explicit id can be added again after the task completes', async () => {
    const queue = createTaskQueue()
    const first = queue.add(async () => 'a', { id: 'reuse' })
    await first.promise
    await tick()

    // Before the fix: threw "Vobs Queue: task reuse already exists"
    const second = queue.add(async () => 'b', { id: 'reuse' })
    await expect(second.promise).resolves.toBe('b')

    queue.dispose()
  })

  it('does not throw for reusable idFactory ids because of historical tasks', async () => {
    const queue = createTaskQueue({ idFactory: () => 'fixed-key' })
    await queue.add(async () => 1).promise
    await tick()
    await expect(queue.add(async () => 2).promise).resolves.toBe(2)
    queue.dispose()
  })

  it('same-named ids **in flight** simultaneously are still deduplicated (existing semantics preserved)', async () => {
    const queue = createTaskQueue()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = queue.add(async () => { await gate; return 1 }, { id: 'busy' })

    expect(() => queue.add(async () => 2, { id: 'busy' })).toThrow()
    release()
    await running.promise
    queue.dispose()
  })

  it('finished tasks are removed from tasks (no more unbounded growth in long sessions)', async () => {
    const queue = createTaskQueue()
    for (let i = 0; i < 5; i++) {
      await queue.add(async () => i).promise
      await tick()
    }
    // Before the fix: this was 5 (append-only, never removed)
    expect(queue.tasks.value.length, 'finished tasks were not removed from tasks').toBe(0)
    queue.dispose()
  })

  it('queued / running tasks still stay in tasks', async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = queue.add(async () => { await gate; return 1 })
    const waiting = queue.add(async () => 2)

    expect(queue.tasks.value.length, 'in-flight tasks must not be removed from tasks').toBe(2)

    release()
    await running.promise
    await waiting.promise
    await tick()
    expect(queue.tasks.value.length).toBe(0)
    queue.dispose()
  })

  it('statistics remain correct after completion (total is not broken by the removal)', async () => {
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

  it('failed tasks are removed too (not only successful ones)', async () => {
    const queue = createTaskQueue()
    await queue.add(async () => { throw new Error('boom') }).promise.catch(() => undefined)
    await tick()
    expect(queue.tasks.value.length, 'failed tasks were not removed').toBe(0)
    expect(queue.failed.value).toBe(1)
    queue.dispose()
  })
})
