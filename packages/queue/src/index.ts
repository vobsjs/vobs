import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
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
  const tasks = state<readonly QueueTask[]>([])
  const pending = state(0)
  const processing = state(0)
  const completed = state(0)
  const failed = state(0)
  const total = state(0)
  const paused = state(false)
  const queue: InternalTask<any>[] = []
  const ownedTasks = new Set<InternalTask<any>>()
  let sequence = 0
  let active = 0
  let nextId = 0
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
        throw new QueueError('INVALID_TASK', 'Vobs Queue: task 必须是函数')
      }
      const id = taskOptions.id ?? options.idFactory?.() ?? `task-${++nextId}`
      if (typeof id !== 'string' || id.trim() === '') {
        throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: task id 必须是非空字符串')
      }
      if (tasks.value.some(task => task.id === id)) {
        throw new QueueError('INVALID_QUEUE_OPTIONS', `Vobs Queue: 已存在任务 ${id}`)
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
      throw new QueueError('INVALID_QUEUE_OPTIONS', `Vobs Queue: 不支持任务优先级 ${String(priority)}`)
    }
    const maxRetries = taskOptions.retry ?? 0
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retry 必须是大于等于 0 的整数')
    }
    const retryDelay = taskOptions.retryDelay ?? 0
    validateRetryDelay(retryDelay)

    const status = state<QueueTaskStatus>('pending')
    const attempt = state(0)
    const result = state<T | null>(null)
    const error = state<Error | null>(null)
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
        const cancellation = new QueueError('QUEUE_TASK_CANCELLED', `Vobs Queue: 任务 ${id} 已取消`)
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
        return execute(task).finally(() => {
          task.executing = false
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
      return new Promise<T>((resolve, reject) => {
        task.resolve = resolve
        task.reject = reject
      })
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
          const cancellation = new QueueError('QUEUE_TASK_CANCELLED', `Vobs Queue: 任务 ${task.id} 已取消`, reason)
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
    let nextPending = 0
    let nextProcessing = 0
    let nextCompleted = 0
    let nextFailed = 0
    for (const task of tasks.value) {
      if (task.status.value === 'pending') nextPending++
      else if (task.status.value === 'running' || task.status.value === 'retrying') nextProcessing++
      else if (task.status.value === 'success') nextCompleted++
      else if (task.status.value === 'error') nextFailed++
    }
    pending.value = nextPending
    processing.value = nextProcessing
    completed.value = nextCompleted
    failed.value = nextFailed
    total.value = tasks.value.length
  }

  function settleTask<T>(task: InternalTask<T>, value?: T, reason?: unknown): void {
    if (task.settled) return
    task.settled = true
    if (reason !== undefined) task.reject?.(reason)
    else task.resolve?.(value as T)
    task.resolve = null
    task.reject = null
  }

  function report(queueError: QueueError, task: QueueTask): void {
    try { options.onError?.(queueError, task) } catch { /* observers cannot break queue state */ }
  }

  function ensureActive(): void {
    if (disposed) throw new QueueError('QUEUE_CONTEXT_DISPOSED', 'Vobs Queue: 上下文已销毁')
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
  if (!queue) throw new QueueError('QUEUE_CONTEXT_MISSING', 'Vobs Queue: 找不到上下文，请安装 queuePlugin')
  return queue
}

function resolveConcurrency(options: TaskQueueOptions): number {
  if (options.concurrency !== undefined && options.concurrent !== undefined && options.concurrency !== options.concurrent) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: concurrency 与 concurrent 不能设置为不同值')
  }
  const value = options.concurrency ?? options.concurrent ?? 3
  if (!Number.isInteger(value) || value <= 0) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: concurrency 必须是正整数')
  }
  return value
}

function validateRetryDelay(value: QueueRetryDelay): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retryDelay 必须是大于等于 0 的有限数字或函数')
  }
  if (typeof value !== 'number' && typeof value !== 'function') {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retryDelay 必须是数字或函数')
  }
}

function resolveRetryDelay(value: QueueRetryDelay, attempt: number, error: Error): number {
  const delay = typeof value === 'function' ? value(attempt, error) : value
  if (!Number.isFinite(delay) || delay < 0) {
    throw new QueueError('INVALID_QUEUE_OPTIONS', 'Vobs Queue: retryDelay 函数必须返回大于等于 0 的有限数字')
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
  return new QueueError('QUEUE_TASK_FAILED', `Vobs Queue: 任务 ${id} 执行失败`, reason)
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
