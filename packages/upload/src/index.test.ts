import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHTTPClient, httpPlugin, type RequestConfig } from '@vobs/http'
import { createText, createVobs } from '@vobs/vobs'
import {
  UPLOAD_KEY,
  UploadError,
  createUpload,
  uploadPlugin,
  useUpload
} from './index'

function createFile(name: string, type: string, content = 'file'): File {
  return new File([content], name, { type })
}

function response(data: unknown, config: RequestConfig) {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    config,
    raw: null
  }
}

describe('@vobs/upload', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('encodes file and metadata into FormData and updates reactive tasks from HTTP progress', async () => {
    let body: FormData | undefined
    const http = createHTTPClient({
      adapter: config => {
        body = config.body as FormData
        config.onUploadProgress?.({ loaded: 5, total: 10, percent: 50 })
        return response({ url: '/files/report.pdf' }, config)
      }
    })
    const uploader = createUpload({
      http,
      url: '/upload',
      fieldName: 'document',
      metadata: { tenant: 'acme', published: true },
      concurrency: 1
    })
    const task = uploader.upload(createFile('report.pdf', 'application/pdf'))

    await expect(task.promise).resolves.toEqual({ url: '/files/report.pdf' })
    expect(task.status.value).toBe('success')
    expect(task.progress.value).toBe(100)
    expect(body?.get('tenant')).toBe('acme')
    expect(body?.get('published')).toBe('true')
    expect((body?.get('document') as File).name).toBe('report.pdf')
    uploader.dispose()
  })

  /*
   * A thrown error from the response mapper was originally collapsed into `UPLOAD_FAILED`,
   * **indistinguishable** from a transfer failure.
   * Consequence: the caller/retry UI could only blindly retry, and the default POST is not
   * idempotent — the file was already received and stored by the server, so retrying equals a
   * silent duplicate write server-side (report probe F: adapter calls 1→2).
   */
  it('response mapper errors are reported separately from transfer failures so callers do not blindly retry', async () => {
    const http = createHTTPClient({
      adapter: config => response({ ok: true }, config)
    })
    const uploader = createUpload({
      http,
      url: '/upload',
      concurrency: 1,
      response: () => { throw new Error('unexpected response shape') }
    })

    const task = uploader.upload(createFile('report.pdf', 'application/pdf'))
    await expect(task.promise).resolves.toBeNull()
    expect(task.status.value).toBe('error')
    expect(task.error.value?.code).toBe('UPLOAD_RESPONSE_INVALID')
    expect(task.error.value?.message).toContain('do not blindly retry')
    uploader.dispose()
  })

  it('a real transfer failure is still UPLOAD_FAILED', async () => {
    const http = createHTTPClient({
      adapter: () => { throw new Error('network down') }
    })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })

    const task = uploader.upload(createFile('report.pdf', 'application/pdf'))
    await expect(task.promise).resolves.toBeNull()
    expect(task.error.value?.code).toBe('UPLOAD_FAILED')
    uploader.dispose()
  })

  /*
   * `clearCompleted()` originally only shrank the public array: completed task objects, their 4
   * signals, and the `File` reference stayed strongly referenced by the internal createdTasks
   * until dispose() — a long-lived upload panel was a monotonic leak.
   * Now cleared rows are disposed together with their signals, so writes to their signals become
   * no-ops (the read value does not change).
   */
  it('clearCompleted releases completed tasks (the cleared handles\' signals are disposed)', async () => {
    const http = createHTTPClient({ adapter: config => response({ ok: true }, config) })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })
    const task = uploader.upload(createFile('a.pdf', 'application/pdf'))
    await expect(task.promise).resolves.toEqual({ ok: true })
    expect(task.status.value).toBe('success')

    uploader.clearCompleted()
    expect(uploader.tasks.value).toHaveLength(0)

    const before = task.status.value
    try {
      task.status.value = 'error'
    } catch {
      // a disposed signal may also reject writes outright; both shapes count as "released"
    }
    expect(task.status.value).toBe(before)

    uploader.dispose()
  })

  /*
   * `tasks` is a **publicly writable** Signal. Once the caller writes it to [], the original
   * dispose iterated only tasks.value → not a single task got cancelled: in-flight uploads kept
   * running and `await task.promise` hung forever (the shape of report probe G).
   * createdTasks is the source of truth for tasks in flight.
   */
  it('dispose still cancels in-flight uploads after the public tasks is emptied', async () => {
    const http = createHTTPClient({ adapter: () => new Promise(() => undefined) })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })
    const task = uploader.upload(createFile('a.pdf', 'application/pdf'))
    await vi.waitFor(() => expect(task.status.value).toBe('uploading'))

    uploader.tasks.value = Object.freeze([])

    uploader.dispose()
    await expect(task.promise).resolves.toBeNull()
    expect(task.status.value).toBe('cancelled')
  })

  it('validates MIME, extension, and file size, rejecting invalid files before task creation', () => {
    const uploader = createUpload({
      http: createHTTPClient(),
      url: '/upload',
      accept: ['image/*', '.pdf'],
      maxFileSize: 4
    })

    expect(() => uploader.upload(createFile('notes.txt', 'text/plain'))).toThrowError(
      expect.objectContaining({ code: 'FILE_TYPE_UNSUPPORTED' })
    )
    expect(() => uploader.upload(createFile('large.pdf', 'application/pdf', 'large'))).toThrowError(
      expect.objectContaining({ code: 'FILE_TOO_LARGE' })
    )
    expect(uploader.tasks.value).toEqual([])
    uploader.dispose()
  })

  it('the service caps concurrency; later tasks start only after the previous one ends', async () => {
    const resolvers: Array<() => void> = []
    let running = 0
    let maxRunning = 0
    const http = createHTTPClient({
      adapter: config => new Promise(resolve => {
        running++
        maxRunning = Math.max(maxRunning, running)
        resolvers.push(() => {
          running--
          resolve(response({ id: config.url }, config))
        })
      })
    })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })
    const [first, second] = uploader.uploadAll([
      createFile('one.txt', 'text/plain'),
      createFile('two.txt', 'text/plain')
    ])

    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    resolvers.shift()?.()
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    resolvers.shift()?.()
    await Promise.all([first.promise, second.promise])

    expect(maxRunning).toBe(1)
    expect(first.status.value).toBe('success')
    expect(second.status.value).toBe('success')
    uploader.dispose()
  })

  it('cancels an uploading task, retries a failed task, and clears completed tasks', async () => {
    let attempt = 0
    let aborted = false
    const http = createHTTPClient({
      adapter: config => new Promise((resolve, reject) => {
        attempt++
        config.signal?.addEventListener('abort', () => {
          aborted = true
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
        if (attempt === 2) reject(new Error('network failed'))
        if (attempt === 3) resolve(response({ id: 'recovered' }, config))
        if (attempt === 4) resolve(response({ id: 'done' }, config))
      })
    })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })
    const cancelled = uploader.upload(createFile('cancel.txt', 'text/plain'))
    await vi.waitFor(() => expect(cancelled.status.value).toBe('uploading'))
    cancelled.cancel()
    await expect(cancelled.promise).resolves.toBeNull()
    expect(aborted).toBe(true)
    expect(cancelled.status.value).toBe('cancelled')

    const failed = uploader.upload(createFile('failed.txt', 'text/plain'))
    await vi.waitFor(() => expect(failed.status.value).toBe('error'))
    await expect(failed.retry()).resolves.toEqual({ id: 'recovered' })
    const complete = uploader.upload(createFile('done.txt', 'text/plain'))
    await expect(complete.promise).resolves.toEqual({ id: 'done' })
    uploader.clearCompleted()

    expect(uploader.tasks.value).toEqual([])
    uploader.dispose()
  })

  it('uploadPlugin prefers the injected HTTPClient and releases its own tasks after app destruction', async () => {
    const http = createHTTPClient({ adapter: config => response({ ok: true }, config) })
    let injected: ReturnType<typeof createUpload> | undefined
    const app = createVobs({
      render: () => createText('upload'),
      plugins: [
        httpPlugin({ client: http }),
        uploadPlugin({ url: '/upload' }),
        { name: 'consumer', install(context) { injected = context.inject(UPLOAD_KEY) } }
      ]
    })
    const task = injected?.upload(createFile('ok.txt', 'text/plain'))
    await task?.promise
    app.destroy()

    expect(() => injected?.upload(createFile('later.txt', 'text/plain'))).toThrow('disposed')
  })

  it('gives clear errors when the plugin is not installed or the HTTPClient is missing', () => {
    expect(() => uploadPlugin({ url: '/upload' }).install?.({
      inject: () => undefined,
      provide: () => undefined
    } as never)).toThrowError(expect.objectContaining({ code: 'UPLOAD_CONTEXT_MISSING' }))
    const app = createVobs({ render: () => {
      useUpload()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'UPLOAD_CONTEXT_MISSING' })
    )
    expect(UploadError).toBeDefined()
  })
})
