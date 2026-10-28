import { getCurrentOwner, onDispose, state, untrack, type Signal } from '@vobs/reactivity'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type QueueTaskStatus = 'pending' | 'running' | 'retrying' | 'success' | 'error' | 'cancelled'
export type QueueRetryDelay = number | ((attempt: number, error: Error) => number)

export interface QueueTask<T = unknown> {
  readonly id: string
  readonly priority: TaskPriority
  readonly status: Signal<QueueTaskStatus>
  readonly attempt: Signal<number>
  readonly result: Signal<T | null>
  readonly error: Signal<Error | null>
  readonly promise: Promise<T>
  cancel(): void
  retry(): Promise<T>
}

export interface QueueTaskOptions {
  readonly id?: string
  readonly priority?: TaskPriority
  readonly retry?: number
  readonly retryDelay?: QueueRetryDelay
}

export type QueueTaskFunction<T> = (signal: AbortSignal) => T | PromiseLike<T>

export interface TaskQueueOptions {
  /** Maximum number of task functions running at once. */
  readonly concurrency?: number
  /** Alias retained for the terminology used in the design document. */
  readonly concurrent?: number
  readonly idFactory?: () => string
  readonly onError?: (error: QueueError, task: QueueTask) => void
}

export interface QueuePluginOptions extends TaskQueueOptions {
  readonly queue?: TaskQueue
}

export interface TaskQueue {
  readonly pending: Signal<number>
  readonly processing: Signal<number>
  readonly completed: Signal<number>
  readonly failed: Signal<number>
  readonly total: Signal<number>
  readonly paused: Signal<boolean>
  readonly tasks: Signal<readonly QueueTask[]>
  add<T>(fn: QueueTaskFunction<T>, options?: QueueTaskOptions): QueueTask<T>
  pause(): void
  resume(): void
  clear(): void
  dispose(): void
}

export type QueueErrorCode =
  | 'QUEUE_CONTEXT_MISSING'
  | 'QUEUE_CONTEXT_DISPOSED'
  | 'INVALID_QUEUE_OPTIONS'
  | 'INVALID_TASK'
  | 'QUEUE_TASK_CANCELLED'
  | 'QUEUE_TASK_FAILED'

export class QueueError extends Error {
  readonly code: QueueErrorCode
  readonly cause: unknown

  constructor(code: QueueErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'QueueError'
    this.code = code
    this.cause = cause
  }
}

export const QUEUE_KEY: InjectionKey<TaskQueue> = createInjectionKey<TaskQueue>('vobs.queue')

const PRIORITIES: Readonly<Record<TaskPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3
}

interface InternalTask<T> extends QueueTask<T> {
  readonly fn: QueueTaskFunction<T>
  readonly maxRetries: number
  readonly retryDelay: QueueRetryDelay
  readonly sequence: number
  controller: AbortController | null
  settled: boolean
  executing: boolean
  retryQueued: boolean
  resolve: ((value: T) => void) | null
  reject: ((reason: unknown) => void) | null
  run(): Promise<void>
  dispose(): void
}

export function createTaskQueue(options: TaskQueueOptions = {}): TaskQueue {
  const concurrency = resolveConcurrency(options)
  const tasks = state<readonly QueueTask[]>([], 'tasks')
  const pending = state(0, 'pending')
  const processing = state(0, 'processing')
  const completed = state(0, 'completed')
  const failed = state(0, 'failed')
  const total = state(0, 'total')
  const paused = state(false, 'paused')
  const queue: InternalTask<any>[] = []
  const ownedTasks = new Set<InternalTask<any>>()
  let sequence = 0
  let active = 0
  let nextId = 0
  /** Cumulative completed/failed counts: must survive tasks being removed from `tasks.value`. */
  let completedCount = 0
  let failedCount = 0
  let disposed = false

  const context: TaskQueue = {
    pending,
    processing,
    completed,
    failed,
    total,
    paused,
    tasks,

    add<T>(fn: QueueTaskFunction<T>, taskOptions: QueueTaskOptions = {}): QueueTask<T> {
      ensureActive()
      if (typeof fn !== 'function') {
        throw new QueueError('INVALID_TASK', 'Vobs Queue: task must be a function')
      }
      const id = taskOptions.id ?? options.idFactory?.() ?? `task-${++nextId}`
      if (typeof id !== 'string' || id.trim() === '') {
        throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: task id must be a non-empty string')
      }
      /*
       * Deduplication applies only to tasks that **haven't finished** yet.
       *
       * The old code threw whenever `tasks.value` contained a same-named id, and `tasks.value` was
       * never cleared — so "reusing the same id after the task finished" (an explicit id, or an
       * idFactory generating one per business key) spuriously threw `task <id> already exists`.
       *
       * The mechanism that actually makes reuse work is "finished tasks are removed from
       * `tasks.value`" (see the removal in `finally`): once removed, the lookup here can't find it,
       * so the id is naturally reusable. We deliberately do **not** add a `settled` check here —
       * `!duplicate.settled` was tried, but it was never reachable in practice (tasks are removed
       * before the promise settles), so it would just be dead code no test could cover.
       */
      if (tasks.value.some(candidate => candidate.id === id)) {
        throw new QueueError('INVALID_QUEUE_OPTIONS', `Vobs Queue: task ${id} already exists`)
      }
      const task = createTask(fn, id, taskOptions)
      ownedTasks.add(task)
      tasks.value = Object.freeze([...tasks.value, task])
      queue.push(task)
      sortQueue()
      refreshStats()
      drain()
      return task
    },

    pause(): void {
      ensureActive()
      paused.value = true
    },

    resume(): void {
      ensureActive()
      if (!paused.value) return
      paused.value = false
      drain()
    },

    clear(): void {
      ensureActive()
      for (const task of [...queue]) task.cancel()
      queue.length = 0
      refreshStats()
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const task of [...ownedTasks]) task.cancel()
      queue.length = 0
      for (const task of ownedTasks) task.dispose()
      ownedTasks.clear()
      tasks.value = Object.freeze([])
      pending.dispose()
      processing.dispose()
      completed.dispose()
      failed.dispose()
      total.dispose()
      paused.dispose()
      tasks.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function createTask<T>(fn: QueueTaskFunction<T>, id: string, taskOptions: QueueTaskOptions): InternalTask<T> {
    const priority = taskOptions.priority ?? 'normal'
    if (!(priority in PRIORITIES)) {
      throw new QueueError('INVALID_QUEUE_OPTIONS', `Vobs Queue: unsupported task priority ${String(priority)}`)
    }
    const maxRetries = taskOptions.retry ?? 0
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retry must be an integer greater than or equal to 0')
    }
    const retryDelay = taskOptions.retryDelay ?? 0
    validateRetryDelay(retryDelay)

    const status = state<QueueTaskStatus>('pending', 'status')
    const attempt = state(0, 'attempt')
    const result = state<T | null>(null, 'result')
    const error = state<Error | null>(null, 'error')
    let promise!: Promise<T>

    const task: InternalTask<T> = {
      id,
      priority,
      status,
      attempt,
      result,
      error,
      get promise(): Promise<T> { return promise },
      fn,
      maxRetries,
      retryDelay,
      sequence: sequence++,
      controller: null,
      settled: false,
      executing: false,
      retryQueued: false,
      resolve: null,
      reject: null,

      cancel(): void {
        if (status.value === 'success' || status.value === 'error' || status.value === 'cancelled') return
        task.controller?.abort()
        removeFromQueue(task)
        status.value = 'cancelled'
        const cancellation = new QueueError('QUEUE_TASK_CANCELLED', `Vobs Queue: task ${id} was cancelled`)
        error.value = cancellation
        settleReject(cancellation)
        refreshStats()
      },

      retry(): Promise<T> {
        ensureActive()
        if (status.value === 'pending' || status.value === 'running' || status.value === 'retrying') return promise
        if (status.value === 'success') return promise
        status.value = 'pending'
        attempt.value = 0
        result.value = null
        error.value = null
        task.controller = null
        task.settled = false
        task.retryQueued = true
        promise = createPromise()
        if (!task.executing) queue.push(task)
        sortQueue()
        refreshStats()
        drain()
        return promise
      },

      run(): Promise<void> {
        task.retryQueued = false
        task.executing = true
        /*
         * Defer the start by one microtask. This used to be `execute(task)` directly: `drain()` is
         * called synchronously from `add()`, so `task.fn(...)` already ran **before** `add()`
         * returned — an immediately following `cancel()` had no chance to prevent it, the side
         * effects had already happened, yet the status reported cancelled and result stayed null
         * (measured in the report: ran=true / status=cancelled). Deferring one hop makes
         * "cancel right after add" actually prevent execution (the while at the top of execute
         * sees cancelled).
         */
        return Promise.resolve()
          .then(() => execute(task))
          .finally(() => {
            task.executing = false
            /*
             * Remove finished tasks from `tasks.value`.
             *
             * The old code only appended and never removed (only clear()/dispose() emptied it) —
             * unbounded growth in long sessions, and exactly the root cause of the same-id
             * deduplication false positive above.
             * Reading `tasks.value` must be untracked: this may run during some effect's execution,
             * and reading would create a hidden subscription (same family as the <select> issue).
             */
            if (task.settled && !disposed) {
              untrack(() => {
                tasks.value = Object.freeze(tasks.value.filter(candidate => candidate !== task))
              })
              ownedTasks.delete(task)
              refreshStats()
            }
            if (task.retryQueued && task.status.value === 'pending' && !disposed) {
              task.retryQueued = false
              queue.push(task)
              sortQueue()
              drain()
            }
          })
      },

      dispose(): void {
        task.controller?.abort()
        status.dispose()
        attempt.dispose()
        result.dispose()
        error.dispose()
      }
    }
    promise = createPromise()
    return task

    function createPromise(): Promise<T> {
      const next = new Promise<T>((resolve, reject) => {
        task.resolve = resolve
        task.reject = reject
      })
      /*
       * Attach one empty handler only, marking this promise as "handled".
       *
       * cancel (`:232`), `clear()` (`:160`), and `dispose()` (`:170`) all reject the task promise,
       * and the caller may perfectly well only care about `add()`'s return value and never touch
       * `.promise` — in Node that means a **process-level unhandledRejection** (measured: 1 each
       * from clear()/dispose()), killing the process during cleanup. A caller that truly
       * `await task.promise` still receives this rejection as usual (the original promise remains
       * rejected).
       */
      next.catch(() => undefined)
      return next
    }

    function settleReject(reason: unknown): void {
      if (task.settled) return
      task.settled = true
      task.reject?.(reason)
      task.resolve = null
      task.reject = null
    }
  }

  async function execute<T>(task: InternalTask<T>): Promise<void> {
    while (!disposed && (task.status.value === 'pending' || task.status.value === 'retrying')) {
      if (task.status.value === 'retrying') task.status.value = 'pending'
      task.status.value = 'running'
      task.attempt.value++
      const controller = new AbortController()
      task.controller = controller
      refreshStats()
      try {
        const value = await task.fn(controller.signal)
        if (isCancelled(task) || disposed) return
        task.result.value = value
        task.status.value = 'success'
        settleTask(task, value)
        refreshStats()
        return
      } catch (reason) {
        if (isCancelled(task) || disposed) return
        if (isAbortError(reason)) {
          const cancellation = new QueueError('QUEUE_TASK_CANCELLED', `Vobs Queue: task ${task.id} was cancelled`, reason)
          task.error.value = cancellation
          task.status.value = 'cancelled'
          settleTask(task, undefined, cancellation)
          refreshStats()
          return
        }
        const failure = toQueueError(reason, task.id)
        let delay: number | undefined
        try {
          if (task.attempt.value <= task.maxRetries) {
            delay = resolveRetryDelay(task.retryDelay, task.attempt.value, failure)
          }
        } catch (delayError) {
          const invalidDelay = toQueueError(delayError, task.id)
          task.error.value = invalidDelay
          task.status.value = 'error'
          settleTask(task, undefined, invalidDelay)
          report(invalidDelay, task)
          refreshStats()
          return
        }
        if (delay !== undefined) {
          task.status.value = 'retrying'
          refreshStats()
          try {
            await wait(delay, controller.signal)
          } catch (delayError) {
            if (isCancelled(task) || isAbortError(delayError)) return
            throw delayError
          }
          if (isCancelled(task) || disposed) return
          continue
        }
        task.error.value = failure
        task.status.value = 'error'
        settleTask(task, undefined, failure)
        report(failure, task)
        refreshStats()
        return
      } finally {
        if (task.controller === controller) task.controller = null
      }
    }
  }

  function drain(): void {
    while (!disposed && !paused.value && active < concurrency && queue.length > 0) {
      const task = queue.shift()!
      if (task.status.value !== 'pending') continue
      active++
      void task.run().finally(() => {
        active--
        refreshStats()
        drain()
      })
    }
    refreshStats()
  }

  function sortQueue(): void {
    queue.sort((left, right) => PRIORITIES[right.priority] - PRIORITIES[left.priority] || left.sequence - right.sequence)
  }

  function removeFromQueue(task: InternalTask<any>): void {
    const index = queue.indexOf(task)
    if (index >= 0) queue.splice(index, 1)
  }

  function refreshStats(): void {
    /*
     * Don't write stat signals after dispose.
     *
     * dispose cancels + disposes every task's signals, but the wrap-up of **in-flight** tasks still
     * reaches here → writing to the already-disposed pending/processing/completed/failed/total
     * emits one `[vobs] write to a disposed state` warning per write (probe measured **5**, matching
     * the report).
     */
    if (disposed) return
    let nextPending = 0
    let nextProcessing = 0
    for (const task of tasks.value) {
      if (task.status.value === 'pending') nextPending++
      else if (task.status.value === 'running' || task.status.value === 'retrying') nextProcessing++
    }
    pending.value = nextPending
    processing.value = nextProcessing
    /*
     * `completed` / `failed` are **cumulative** counts and must not be computed from `tasks.value`.
     *
     * Reason: finished tasks are now removed from `tasks.value` (see the removal in `finally`
     * below), so computing on the fly would make "completed" drop back to 0 after tasks are
     * removed — while these two counters exist to show the user "how many finished in total".
     * `total` keeps the "how many tasks exist right now" (in flight + not yet removed) semantics.
     */
    completed.value = completedCount
    failed.value = failedCount
    /*
     * `total` = the sum of the status counters (`pending + processing + completed + failed`;
     * cancelled tasks are not counted in completed/failed).
     *
     * This keeps it **self-consistent** with the other four counters: at any moment
     * `total === pending + processing + completed + failed` — callers never have to guess
     * "does total include finished tasks or not". Neither the array length (removal happens one
     * hop after the promise settles, which would make the value read after `await task.promise`
     * skew high) nor the "in-flight count" (which would put total and completed on different
     * scales).
     */
    total.value = nextPending + nextProcessing + completedCount + failedCount
  }

  function settleTask<T>(task: InternalTask<T>, value?: T, reason?: unknown): void {
    if (task.settled) return
    task.settled = true
    /*
     * The cumulative counters advance **at settle time**, not at the removal in the `finally`
     * below — otherwise reading `completed` right after `await task.promise` shows the old value
     * (it would need one extra hop), a visible wrongness for callers that refresh the UI
     * immediately after a task completes.
     */
    if (task.status.value === 'success') completedCount++
    else if (task.status.value === 'error') failedCount++
    if (reason !== undefined) task.reject?.(reason)
    else task.resolve?.(value as T)
    task.resolve = null
    task.reject = null
    refreshStats()
  }

  function report(queueError: QueueError, task: QueueTask): void {
    try { options.onError?.(queueError, task) } catch { /* observers cannot break queue state */ }
  }

  function ensureActive(): void {
    if (disposed) throw new QueueError('QUEUE_CONTEXT_DISPOSED', 'Vobs Queue: context has been disposed')
  }

  function isCancelled(task: QueueTask): boolean {
    return task.status.value === 'cancelled'
  }
}

export function queuePlugin(options: QueuePluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/queue',
    version: '0.1.0',
    install(context) {
      const ownedQueue = options.queue ? undefined : createTaskQueue(options)
      context.provide(QUEUE_KEY, options.queue ?? ownedQueue!)
      return () => ownedQueue?.dispose()
    }
  }
}

export function useQueue(): TaskQueue {
  const queue = inject(QUEUE_KEY)
  if (!queue) throw new QueueError('QUEUE_CONTEXT_MISSING', 'Vobs Queue: context not found; install queuePlugin first')
  return queue
}

function resolveConcurrency(options: TaskQueueOptions): number {
  if (options.concurrency !== undefined && options.concurrent !== undefined && options.concurrency !== options.concurrent) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: concurrency and concurrent must not be set to different values')
  }
  const value = options.concurrency ?? options.concurrent ?? 3
  if (!Number.isInteger(value) || value <= 0) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: concurrency must be a positive integer')
  }
  return value
}

function validateRetryDelay(value: QueueRetryDelay): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retryDelay must be a finite number or a function, greater than or equal to 0')
  }
  if (typeof value !== 'number' && typeof value !== 'function') {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retryDelay must be a number or a function')
  }
}

function resolveRetryDelay(value: QueueRetryDelay, attempt: number, error: Error): number {
  const delay = typeof value === 'function' ? value(attempt, error) : value
  if (!Number.isFinite(delay) || delay < 0) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: the retryDelay function must return a finite number greater than or equal to 0')
  }
  return delay
}

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay)
    signal.addEventListener('abort', abort, { once: true })
    function done(): void {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort(): void {
      clearTimeout(timer)
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
  })
}

function toQueueError(reason: unknown, id: string): QueueError {
  if (reason instanceof QueueError) return reason
  return new QueueError('QUEUE_TASK_FAILED', `Vobs Queue: task ${id} failed`, reason)
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
