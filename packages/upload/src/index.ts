import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
import { HTTP_KEY, type HTTPClient, type HTTPProgress, type RequestOptions } from '@vobs/http'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error' | 'cancelled'

export type UploadFile = Blob & { readonly name?: string; readonly lastModified?: number }

export type UploadMetadata = Readonly<Record<string, string | number | boolean | Blob | null | undefined>>

export interface UploadTask<Result = unknown> {
  readonly id: string
  readonly file: UploadFile
  readonly progress: Signal<number>
  readonly status: Signal<UploadStatus>
  readonly error: Signal<UploadError | null>
  readonly result: Signal<Result | null>
  readonly promise: Promise<Result | null>
  cancel(): void
  retry(): Promise<Result | null>
}

export interface UploadTaskOptions<Result = unknown> {
  readonly id?: string
  readonly fieldName?: string
  readonly fileName?: string
  readonly metadata?: UploadMetadata
  readonly headers?: HeadersInit
  readonly timeout?: number
  readonly retry?: number
  readonly retryDelay?: RequestOptions['retryDelay']
  readonly shouldRetry?: RequestOptions['shouldRetry']
  readonly response?: (data: unknown, task: UploadTask<Result>) => Result | PromiseLike<Result>
}

export interface UploadOptions<Result = unknown> extends Omit<UploadTaskOptions<Result>, 'id' | 'metadata' | 'response'> {
  readonly http: HTTPClient
  readonly url: string
  readonly method?: 'POST' | 'PUT' | 'PATCH'
  readonly fieldName?: string
  readonly metadata?: UploadMetadata
  readonly accept?: string | readonly string[]
  readonly maxFileSize?: number
  readonly concurrency?: number
  readonly idFactory?: () => string
  readonly response?: (data: unknown, task: UploadTask<Result>) => Result | PromiseLike<Result>
}

export interface UploadPluginOptions<Result = unknown> extends Omit<UploadOptions<Result>, 'http'> {
  readonly http?: HTTPClient
  readonly upload?: UploadContext<Result>
}

export interface UploadContext<Result = unknown> {
  readonly tasks: Signal<readonly UploadTask<Result>[]>
  upload(file: UploadFile, options?: UploadTaskOptions<Result>): UploadTask<Result>
  uploadAll(files: Iterable<UploadFile>, options?: UploadTaskOptions<Result>): readonly UploadTask<Result>[]
  clearCompleted(): void
  dispose(): void
}

export type UploadErrorCode =
  | 'UPLOAD_CONTEXT_MISSING'
  | 'UPLOAD_CONTEXT_DISPOSED'
  | 'UPLOAD_UNAVAILABLE'
  | 'INVALID_UPLOAD_OPTIONS'
  | 'INVALID_FILE'
  | 'FILE_TYPE_UNSUPPORTED'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_FAILED'
  /**
   * Response parse/mapping failure — **must stay separate** from `UPLOAD_FAILED` (transfer
   * failure): reaching this point means the server has already received and possibly stored the
   * upload; blindly retrying under the default POST equals a duplicate write.
   */
  | 'UPLOAD_RESPONSE_INVALID'

export class UploadError extends Error {
  readonly code: UploadErrorCode
  readonly cause: unknown

  constructor(code: UploadErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'UploadError'
    this.code = code
    this.cause = cause
  }
}

// The app injection key does not carry the caller's Result generic; useUpload<T>() restores it on read.
export const UPLOAD_KEY: InjectionKey<UploadContext<any>> = createInjectionKey<UploadContext<any>>('vobs.upload')

export function createUpload<Result = unknown>(options: UploadOptions<Result>): UploadContext<Result> {
  validateOptions(options)
  const fieldName = options.fieldName ?? 'file'
  const concurrency = options.concurrency ?? 3
  const tasks = state<readonly UploadTask<Result>[]>([], 'tasks')
  const createdTasks = new Set<InternalUploadTask<Result>>()
  const queue: Array<() => void> = []
  let nextId = 0
  let active = 0
  let disposed = false

  const context: UploadContext<Result> = {
    tasks,

    upload(file, taskOptions = {}): UploadTask<Result> {
      ensureActive()
      validateFile(file)
      const id = taskOptions.id ?? options.idFactory?.() ?? `upload-${++nextId}`
      if (typeof id !== 'string' || id.trim() === '') {
        throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: task id must be a non-empty string')
      }
      if (tasks.value.some(task => task.id === id)) {
        throw new UploadError('INVALID_UPLOAD_OPTIONS', `Vobs Upload: task ${id} already exists`)
      }
      const task = createTask(file, id, taskOptions)
      createdTasks.add(task)
      tasks.value = Object.freeze([...tasks.value, task])
      enqueue(() => task.__run())
      return task
    },

    uploadAll(files, taskOptions = {}): readonly UploadTask<Result>[] {
      ensureActive()
      return [...files].map(file => context.upload(file, taskOptions))
    },

    clearCompleted(): void {
      ensureActive()
      const retained = tasks.value.filter(task => (
        task.status.value === 'pending' || task.status.value === 'uploading'
      ))
      tasks.value = Object.freeze(retained)
      /*
       * Cleared rows must **also** be removed from createdTasks and have their signals disposed.
       *
       * The original code only shrank the public array: completed task objects, their 4 signals,
       * and the `File` reference stayed strongly referenced by `createdTasks` until `dispose()` —
       * a long-lived upload panel was a monotonic leak (report upload high).
       */
      const retainedSet = new Set<UploadTask<Result>>(retained)
      for (const task of createdTasks) {
        if (retainedSet.has(task)) continue
        createdTasks.delete(task)
        task.__dispose()
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      /*
       * Cancel **every created task**, not just whatever the public `tasks.value` holds.
       *
       * `tasks` is a publicly writable Signal: once the caller (or any code holding the context)
       * writes it to `[]`, the original dispose could not cancel a single one — in-flight uploads
       * kept running and `await task.promise` **hung forever** (report probe G: HUNG, status
       * stuck at uploading). createdTasks is the source of truth for "tasks in flight".
       */
      for (const task of createdTasks) {
        task.cancel()
        task.__dispose()
      }
      createdTasks.clear()
      queue.length = 0
      tasks.value = Object.freeze([])
      tasks.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function createTask(file: UploadFile, id: string, taskOptions: UploadTaskOptions<Result>): InternalUploadTask<Result> {
    const progress = state(0, 'progress')
    const status = state<UploadStatus>('pending', 'status')
    // Narrowed to UploadError: callers rely on `.code` to tell "safe to retry or not" (see UPLOAD_RESPONSE_INVALID)
    const error = state<UploadError | null>(null, 'error')
    const result = state<Result | null>(null, 'result')
    let controller: AbortController | undefined
    let settle: ((value: Result | null) => void) | undefined
    let promise = createPromise()
    let running = false

    const task: InternalUploadTask<Result> = {
      id,
      file,
      progress,
      status,
      error,
      result,
      get promise(): Promise<Result | null> { return promise },

      cancel(): void {
        if (status.value !== 'pending' && status.value !== 'uploading') return
        status.value = 'cancelled'
        controller?.abort()
        settle?.(null)
        settle = undefined
      },

      retry(): Promise<Result | null> {
        ensureActive()
        if (status.value === 'pending' || status.value === 'uploading') return promise
        if (status.value === 'success') return promise
        progress.value = 0
        error.value = null
        result.value = null
        status.value = 'pending'
        promise = createPromise()
        enqueue(() => task.__run())
        return promise
      },

      __run(): Promise<void> {
        if (disposed || status.value !== 'pending' || running) return Promise.resolve()
        running = true
        controller = new AbortController()
        status.value = 'uploading'
        return send().finally(() => {
          running = false
          controller = undefined
        })
      },

      __dispose(): void {
        progress.dispose()
        status.dispose()
        error.dispose()
        result.dispose()
      }
    }
    return task

    function createPromise(): Promise<Result | null> {
      return new Promise(resolve => { settle = resolve })
    }

    async function send(): Promise<void> {
      try {
        const response = await options.http.request({
          url: options.url,
          method: options.method ?? 'POST',
          body: createFormData(file, id, taskOptions),
          headers: taskOptions.headers ?? options.headers,
          timeout: taskOptions.timeout ?? options.timeout,
          retry: taskOptions.retry ?? options.retry,
          retryDelay: taskOptions.retryDelay ?? options.retryDelay,
          shouldRetry: taskOptions.shouldRetry ?? options.shouldRetry,
          signal: controller?.signal,
          onUploadProgress: value => updateProgress(value)
        })
        if (isCancelled() || disposed) return
        const mapper = taskOptions.response ?? options.response ?? ((data: unknown) => data as Result)
        let mapped: Result
        try {
          mapped = await mapper(response.data, task)
        } catch (reason) {
          /*
           * The request **already succeeded**; only our side's response parsing failed. Must be
           * reported separately from transfer failure: if both collapsed into UPLOAD_FAILED, the
           * caller/retry UI could not tell "safe to retry or not" — and the default POST is not
           * idempotent, so retrying after the server has stored the file is a silent duplicate write.
           */
          if (reason instanceof UploadError) throw reason
          throw new UploadError(
            'UPLOAD_RESPONSE_INVALID',
            `Vobs Upload: failed to parse the response for ${fileName(file, id)} (the file may already have been received by the server; do not blindly retry)`,
            reason
          )
        }
        if (isCancelled() || disposed) return
        progress.value = 100
        result.value = mapped
        status.value = 'success'
        settle?.(mapped)
        settle = undefined
      } catch (reason) {
        if (status.value === 'cancelled' || isAbortError(reason) || disposed) return
        const uploadError = reason instanceof UploadError
          ? reason
          : new UploadError('UPLOAD_FAILED', `Vobs Upload: ${fileName(file, id)} upload failed`, reason)
        error.value = uploadError
        status.value = 'error'
        settle?.(null)
        settle = undefined
      }
    }

    function updateProgress(value: HTTPProgress): void {
      if (status.value !== 'uploading' || value.percent === undefined) return
      progress.value = Math.max(0, Math.min(100, value.percent))
    }

    function isCancelled(): boolean {
      return status.value === 'cancelled'
    }
  }

  function createFormData(file: UploadFile, id: string, taskOptions: UploadTaskOptions<Result>): FormData {
    if (typeof FormData === 'undefined') {
      throw new UploadError('UPLOAD_UNAVAILABLE', 'Vobs Upload: no FormData available in the current environment')
    }
    const form = new FormData()
    form.append(taskOptions.fieldName ?? fieldName, file, taskOptions.fileName ?? fileName(file, id))
    const metadata = { ...(options.metadata ?? {}), ...(taskOptions.metadata ?? {}) }
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined || value === null) continue
      if (value instanceof Blob) form.append(key, value)
      else form.append(key, String(value))
    }
    return form
  }

  function enqueue(run: () => void): void {
    queue.push(run)
    drain()
  }

  function drain(): void {
    while (!disposed && active < concurrency && queue.length > 0) {
      const run = queue.shift()!
      active++
      Promise.resolve()
        .then(run)
        .finally(() => {
          active--
          drain()
        })
    }
  }

  function validateFile(file: UploadFile): void {
    if (!isUploadFile(file)) {
      throw new UploadError('INVALID_FILE', 'Vobs Upload: file must be a Blob or File')
    }
    if (options.maxFileSize !== undefined && file.size > options.maxFileSize) {
      throw new UploadError('FILE_TOO_LARGE', `Vobs Upload: file size exceeds the ${options.maxFileSize}-byte limit`)
    }
    if (!matchesAccept(file, options.accept)) {
      throw new UploadError('FILE_TYPE_UNSUPPORTED', `Vobs Upload: unsupported file type ${file.type || fileName(file, 'file')}`)
    }
  }

  function ensureActive(): void {
    if (disposed) throw new UploadError('UPLOAD_CONTEXT_DISPOSED', 'Vobs Upload: context has been disposed')
  }
}

interface InternalUploadTask<Result> extends UploadTask<Result> {
  __run(): Promise<void>
  __dispose(): void
}

export function uploadPlugin<Result = unknown>(options: UploadPluginOptions<Result>): VobsPlugin {
  return {
    name: '@vobs/upload',
    version: '0.1.0',
    install(context) {
      const http = options.http ?? context.inject(HTTP_KEY)
      const ownedUpload = options.upload ? undefined : createUpload({ ...options, http: requireHTTP(http) })
      context.provide(UPLOAD_KEY, options.upload ?? ownedUpload!)
      return () => ownedUpload?.dispose()
    }
  }
}

export function useUpload<Result = unknown>(): UploadContext<Result> {
  const upload = inject(UPLOAD_KEY)
  if (!upload) throw new UploadError('UPLOAD_CONTEXT_MISSING', 'Vobs Upload: context not found; install uploadPlugin first')
  return upload as UploadContext<Result>
}

function validateOptions<Result>(options: UploadOptions<Result>): void {
  if (!options || typeof options !== 'object' || !options.http || typeof options.http.request !== 'function') {
    throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: an HTTPClient is required')
  }
  if (!options.url || typeof options.url !== 'string') {
    throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: url must be a non-empty string')
  }
  if (options.method !== undefined && !['POST', 'PUT', 'PATCH'].includes(options.method)) {
    throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: method must be POST, PUT, or PATCH')
  }
  if (options.maxFileSize !== undefined && (!Number.isFinite(options.maxFileSize) || options.maxFileSize < 0)) {
    throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: maxFileSize must be a finite number greater than or equal to 0')
  }
  if (options.concurrency !== undefined && (!Number.isInteger(options.concurrency) || options.concurrency <= 0)) {
    throw new UploadError('INVALID_UPLOAD_OPTIONS', 'Vobs Upload: concurrency must be a positive integer')
  }
}

function requireHTTP(client: HTTPClient | undefined): HTTPClient {
  if (client) return client
  throw new UploadError('UPLOAD_CONTEXT_MISSING', 'Vobs Upload: HTTPClient not found; install httpPlugin or pass http')
}

function matchesAccept(file: UploadFile, accept: UploadOptions['accept']): boolean {
  if (!accept || (Array.isArray(accept) && accept.length === 0)) return true
  const name = fileName(file, '')
  const accepted = typeof accept === 'string' ? accept.split(',') : accept
  return accepted.map(value => value.trim().toLowerCase()).some(pattern => {
    if (!pattern) return false
    if (pattern.startsWith('.')) return name.toLowerCase().endsWith(pattern)
    if (pattern.endsWith('/*')) return file.type.toLowerCase().startsWith(pattern.slice(0, -1))
    return file.type.toLowerCase() === pattern
  })
}

function isUploadFile(value: unknown): value is UploadFile {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function fileName(file: UploadFile, fallback: string): string {
  return typeof file.name === 'string' && file.name.trim() !== '' ? file.name : fallback
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
