# @vobs/queue

Priority task queue for vobs with concurrency limits, per-task retry, AbortSignal cancellation, and reactive statistics.

## Install

```bash
npm install @vobs/queue
```

## Quick start

```ts
import { createTaskQueue } from '@vobs/queue'

const queue = createTaskQueue({ concurrency: 2 })

const task = queue.add(
  signal => fetch('/api/jobs/42', { signal }).then(res => res.json()),
  { priority: 'high', retry: 2, retryDelay: attempt => attempt * 250 }
)

task.status.value // 'pending', then 'running', 'retrying', 'success', 'error', or 'cancelled'
await task.promise
queue.completed.value // counters: pending, processing, completed, failed, total

task.cancel()      // aborts queued or running tasks through their signal
await task.retry() // re-run a failed or cancelled task
```

Tasks run by priority (`critical`, `high`, `normal`, `low`), FIFO within the same priority. Cancelling aborts the task's `AbortSignal` and rejects its promise with a `QueueError` of code `QUEUE_TASK_CANCELLED`. Failed tasks retry up to `retry` times after `retryDelay`, then settle as `error` and invoke the queue's `onError`. `pause()` stops new tasks from starting until `resume()`.

## API

| Signature | Description |
| --- | --- |
| `createTaskQueue(options?: TaskQueueOptions): TaskQueue` | Options: `concurrency` (default 3, alias `concurrent`), `idFactory`, `onError`. |
| `queue.add(fn, options?): QueueTask` | `fn` receives an `AbortSignal`; task options: `id`, `priority`, `retry`, `retryDelay`. |
| `queue.pause() / resume()` | Hold new tasks, then drain the queue again. |
| `queue.clear()` | Cancel queued tasks; running tasks keep going. |
| `queue.dispose()` | Cancel and release every task and signal. |
| `queue.pending / processing / completed / failed / total / paused / tasks` | Reactive queue statistics. |
| `task.status / attempt / result / error` | Signals tracking one task. |
| `task.promise` | Resolves with the result or rejects with `QueueError`. |
| `task.cancel() / task.retry()` | Abort via the signal; resubmit a settled task. |
| `queuePlugin(options?) / useQueue()` | Provide and inject `QUEUE_KEY` in a vobs app. |
| `QueueError` | Error with `code`: `INVALID_TASK`, `QUEUE_TASK_CANCELLED`, `QUEUE_TASK_FAILED`, `QUEUE_CONTEXT_DISPOSED`. |

## Types

TaskPriority, QueueTaskStatus, QueueRetryDelay, QueueTask, QueueTaskFunction, QueueTaskOptions, TaskQueue, TaskQueueOptions, QueuePluginOptions, QueueErrorCode
