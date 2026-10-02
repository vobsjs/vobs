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

  it('将文件和元数据编码为 FormData，并从 HTTP 进度更新响应式任务', async () => {
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
   * 响应 mapper 抛错原来被归成 `UPLOAD_FAILED`，与传输失败**不可区分**。
   * 后果：调用方/重试 UI 只能盲目重传，而默认 POST 非幂等 —— 文件已被服务端接收并落库，
   * 重传等于服务端静默重复写入（报告探针 F：adapter 调用 1→2）。
   */
  it('响应 mapper 抛错与传输失败分开报，避免调用方盲目重传', async () => {
    const http = createHTTPClient({
      adapter: config => response({ ok: true }, config)
    })
    const uploader = createUpload({
      http,
      url: '/upload',
      concurrency: 1,
      response: () => { throw new Error('响应结构不符合预期') }
    })

    const task = uploader.upload(createFile('report.pdf', 'application/pdf'))
    await expect(task.promise).resolves.toBeNull()
    expect(task.status.value).toBe('error')
    expect(task.error.value?.code).toBe('UPLOAD_RESPONSE_INVALID')
    expect(task.error.value?.message).toContain('不要盲目重传')
    uploader.dispose()
  })

  it('真正的传输失败仍然是 UPLOAD_FAILED', async () => {
    const http = createHTTPClient({
      adapter: () => { throw new Error('network down') }
    })
    const uploader = createUpload({ http, url: '/upload', concurrency: 1 })

    const task = uploader.upload(createFile('report.pdf', 'application/pdf'))
    await expect(task.promise).resolves.toBeNull()
    expect(task.error.value?.code).toBe('UPLOAD_FAILED')
    uploader.dispose()
  })

  it('校验 MIME、扩展名和文件大小，并在创建任务前拒绝无效文件', () => {
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

  it('服务层限制并发，后续任务在前一任务结束后才开始', async () => {
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

  it('取消正在上传的任务，重试失败任务并清除完成任务', async () => {
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

  it('uploadPlugin 优先注入 HTTPClient，并在应用销毁后释放自有任务', async () => {
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

    expect(() => injected?.upload(createFile('later.txt', 'text/plain'))).toThrow('已销毁')
  })

  it('未安装插件或缺少 HTTPClient 时给出明确错误', () => {
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
