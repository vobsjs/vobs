import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHTTPClient,
  createConcurrencyLimiter,
  createAxiosAdapter,
  createFetchAdapter,
  createMockAdapter,
  createSSE,
  createWebSocket,
  createXHRAdapter,
  HTTPError,
  HTTP_KEY,
  httpPlugin,
  TimeoutError,
  toResourceFetcher,
  subscribeHTTPDebug,
  type HTTPClient,
  type HTTPResponse,
  type AxiosRequest
} from './index'
import { createText, createVobs } from '@vobs/vobs'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('@vobs/http', () => {
  it('构造 URL、合并 headers、序列化 JSON body 并解析响应', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ id: 1 }),
      { status: 201, headers: { 'content-type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetcher)
    const client = createHTTPClient({
      adapter: createFetchAdapter(),
      baseURL: '/api',
      headers: { 'X-Base': 'base' }
    })

    const response = await client.post<{ id: number }>('/users', { name: 'Ada' }, {
      params: { page: 1, tags: ['a', 'b'] },
      headers: { 'X-Request': 'request' }
    })

    expect(response.data).toEqual({ id: 1 })
    expect(response.status).toBe(201)
    expect(fetcher).toHaveBeenCalledWith('/api/users?page=1&tags=a&tags=b', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Ada' })
    }))
    const init = fetcher.mock.calls[0]?.[1]
    if (!init) throw new Error('missing RequestInit')
    expect(new Headers(init.headers).get('x-base')).toBe('base')
    expect(new Headers(init.headers).get('x-request')).toBe('request')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
  })

  it('toResourceFetcher 转发 AbortSignal 并解包 HTTPResponse.data', async () => {
    const controller = new AbortController()
    const response: HTTPResponse<{ id: number }> = {
      data: { id: 1 },
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config: {
        url: '/users/1',
        method: 'GET',
        headers: {},
        signal: controller.signal
      },
      raw: null
    }
    const request = vi.fn(() => Promise.resolve(response))

    await expect(toResourceFetcher(request)(controller.signal)).resolves.toEqual({ id: 1 })
    expect(request).toHaveBeenCalledWith(controller.signal)
  })

  it('请求拦截器正序执行，响应拦截器逆序执行', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' }
    })))
    const calls: string[] = []
    const client = createHTTPClient({ adapter: createFetchAdapter() })
    client.interceptors.request.use(config => {
      calls.push('request-a')
      return config
    })
    client.interceptors.request.use(config => {
      calls.push('request-b')
      return config
    })
    client.interceptors.response.use(response => {
      calls.push('response-a')
      return response
    })
    client.interceptors.response.use(response => {
      calls.push('response-b')
      return response
    })

    await client.get('/users')
    expect(calls).toEqual(['request-a', 'request-b', 'response-b', 'response-a'])
  })

  it('非 2xx 响应抛出 HTTPError，并可由响应错误拦截器观察', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ message: 'denied' }),
      { status: 403, statusText: 'Forbidden', headers: { 'content-type': 'application/json' } }
    )))
    const errors: unknown[] = []
    const client = createHTTPClient({ adapter: createFetchAdapter() })
    client.interceptors.response.use(undefined, error => {
      errors.push(error)
      return Promise.reject(error)
    })

    await expect(client.get('/private')).rejects.toBeInstanceOf(HTTPError)
    expect(errors[0]).toBeInstanceOf(HTTPError)
    expect((errors[0] as HTTPError).status).toBe(403)
    expect((errors[0] as HTTPError).data).toEqual({ message: 'denied' })
  })

  it('按条件重试服务端错误，并尊重 AbortController 取消', async () => {
    let attempts = 0
    const fetcher = vi.fn(async () => {
      attempts++
      if (attempts < 3) return new Response('{}', { status: 503 })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetcher)
    const client = createHTTPClient({ adapter: createFetchAdapter(), retry: 2, retryDelay: 0 })
    await expect(client.get('/retry')).resolves.toMatchObject({ data: { ok: true } })
    expect(attempts).toBe(3)

    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort)
    })))
    const request = client.get('/cancel', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('超时会终止 adapter 并抛出 TimeoutError', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort)
    })))

    await expect(createHTTPClient({ adapter: createFetchAdapter(), timeout: 5 }).get('/slow')).rejects.toBeInstanceOf(TimeoutError)
  })

  it('可选请求去重只执行一次 adapter，并共享响应', async () => {
    let resolve!: (response: Response) => void
    const adapter = vi.fn(() => new Promise<Response>(done => { resolve = done }))
    const client = createHTTPClient({ adapter })
    const first = client.get<{ ok: boolean }>('/same', { dedupe: true })
    const second = client.get<{ ok: boolean }>('/same', { dedupe: true })
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
    resolve(new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' }
    }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ data: { ok: true } }),
      expect.objectContaining({ data: { ok: true } })
    ])
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it('Axios adapter 将 response.data 保持为 HTTPResponse<T>.data', async () => {
    const axiosRequest = vi.fn(async (config: { url: string; method: string; data?: unknown }) => ({
      data: { id: 1 },
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config
    })) as unknown as AxiosRequest
    const client = createHTTPClient({ adapter: createAxiosAdapter(axiosRequest) })
    const response = await client.post<{ id: number }>('/users', { name: 'Ada' })

    expect(response.data.id).toBe(1)
    expect(axiosRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: '/users',
      method: 'POST',
      data: { name: 'Ada' }
    }))
  })

  it('自定义 Axios adapter 不会把已序列化的 params 再传给 Axios', async () => {
    const requestMock = vi.fn(async (_config: { url: string; params?: unknown }) => ({
      data: { ok: true },
      status: 200,
      headers: {}
    }))
    const axiosRequest = requestMock as unknown as AxiosRequest
    const client = createHTTPClient({ adapter: createAxiosAdapter(axiosRequest) })

    await client.get('/users', { params: { page: 1 } })

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ url: '/users?page=1' }))
    expect(requestMock.mock.calls[0]?.[0]).not.toHaveProperty('params')
  })

  it('默认客户端使用内置 Axios transport 并保留 Network debug 事件', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetcher)
    const events: import('./debug').HTTPDebugRequest[] = []
    const stop = subscribeHTTPDebug(event => events.push(event))

    const response = await createHTTPClient().get<{ ok: boolean }>('https://example.test/health')

    stop()
    expect(response.data).toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalled()
    expect(events.map(event => event.status)).toEqual(['loading', 'success'])
  })

  it('内置 Axios transport 不会重复拼接 params，并遵守 GET 无 body', async () => {
    let seenURL = ''
    let seenMethod = ''
    let seenBody: unknown
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined
      seenURL = request?.url ?? String(input)
      seenMethod = request?.method ?? init?.method ?? ''
      seenBody = request?.body ?? init?.body
      return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
      })
    })
    vi.stubGlobal('fetch', fetcher)

    const response = await createHTTPClient().request<{ ok: boolean }>({
      url: 'https://example.test/users',
      method: 'GET',
      params: { page: 1, tags: ['a', 'b'] },
      body: { ignored: true }
    })

    expect(response.data).toEqual({ ok: true })
    expect(seenURL).toBe('https://example.test/users?page=1&tags=a&tags=b')
    expect(seenMethod).toBe('GET')
    expect(seenBody == null).toBe(true)
  })

  it('Mock adapter 将普通返回值转换为成功 200 payload', async () => {
    const client = createHTTPClient({
      adapter: createMockAdapter(config => ({ method: config.method, url: config.url }))
    })

    await expect(client.get('/mock-users')).resolves.toMatchObject({
      status: 200,
      data: { method: 'GET', url: '/mock-users' }
    })
  })

  it('Mock adapter 保留字符串和 undefined payload，不强制 JSON 解析', async () => {
    const stringClient = createHTTPClient({ adapter: createMockAdapter(() => 'mocked') })
    const emptyClient = createHTTPClient({ adapter: createMockAdapter(() => undefined) })

    await expect(stringClient.get('/mock-text')).resolves.toMatchObject({ status: 200, data: 'mocked' })
    await expect(emptyClient.get('/mock-empty')).resolves.toMatchObject({ status: 200, data: undefined })
  })

  it('默认 Axios transport 的 responseType response 返回原始 Response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('raw body', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain' }
    })))

    const response = await createHTTPClient().get<Response>('https://example.test/raw', {
      responseType: 'response'
    })

    expect(response.status).toBe(201)
    expect(response.data).toBeInstanceOf(Response)
    expect(response.raw).toBe(response.data)
    await expect((response.data as Response).text()).resolves.toBe('raw body')
  })

  it('并发上限控制 adapter 同时执行数量', async () => {
    const limiter = createConcurrencyLimiter(2)
    let active = 0
    let maximum = 0
    const tasks = Array.from({ length: 5 }, (_, index) => limiter(async () => {
      active++
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active--
      return index
    }))

    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4])
    expect(maximum).toBe(2)
  })

  it('SSE adapter 转发事件回调并支持关闭', () => {
    class FakeEventSource {
      closed = false
      listeners = new Map<string, EventListener[]>()
      constructor(readonly url: string, readonly options?: EventSourceInit) {}
      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }
      close(): void { this.closed = true }
      emit(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener(new Event(type))
      }
    }
    const opened = vi.fn()
    const client = createSSE('/events', {
      eventSource: FakeEventSource as unknown as import('./stream').SSEConstructor,
      onOpen: opened
    })
    ;(client.source as unknown as FakeEventSource).emit('open')
    client.close()
    expect(opened).toHaveBeenCalledTimes(1)
    expect((client.source as unknown as FakeEventSource).closed).toBe(true)
  })

  it('WebSocket adapter 支持连接、发送、事件监听和关闭', () => {
    class FakeWebSocket {
      readyState = 0
      sent: unknown[] = []
      listeners = new Map<string, EventListener[]>()
      constructor(readonly url: string) {}
      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }
      send(data: unknown): void { this.sent.push(data) }
      close(): void {
        this.readyState = 3
        for (const listener of this.listeners.get('close') ?? []) listener(new CloseEvent('close'))
      }
      open(): void {
        this.readyState = 1
        for (const listener of this.listeners.get('open') ?? []) listener(new Event('open'))
      }
    }
    const opened = vi.fn()
    const client = createWebSocket('/socket', {
      webSocket: FakeWebSocket as unknown as import('./stream').WebSocketConstructor
    })
    client.on('open', opened)
    const socket = client.socket as unknown as FakeWebSocket
    socket.open()
    client.send('hello')
    client.close()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(socket.sent).toEqual(['hello'])
    expect(client.state).toBe('closed')
  })

  it('fetch adapter 报告可读响应流的下载进度', async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('{"ok":'), encoder.encode('true}')]
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++])
        else controller.close()
      }
    }), {
      headers: { 'content-type': 'application/json', 'content-length': '9' }
    })))
    const progress: number[] = []
    const response = await createHTTPClient({ adapter: createFetchAdapter() }).get<{ ok: boolean }>('/stream', {
      onDownloadProgress: event => progress.push(event.loaded)
    })

    expect(response.data).toEqual({ ok: true })
    expect(progress).toEqual([6, 11])
  })

  it('下载进度与 text 响应共用一次流读取', async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('hel'), encoder.encode('lo')]
    let index = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++])
        else controller.close()
      }
    }), { headers: { 'content-length': '5' } })))
    const progress: number[] = []

    const response = await createHTTPClient({ adapter: createFetchAdapter() }).get('/text', {
      responseType: 'text',
      onDownloadProgress: event => progress.push(event.loaded)
    })

    expect(response.data).toBe('hello')
    expect(progress).toEqual([3, 5])
  })

  it('XHR adapter 报告上传和下载进度', async () => {
    class FakeXHR {
      static instance: FakeXHR
      readonly upload = { onprogress: (_event: ProgressEvent) => undefined }
      onprogress = (_event: ProgressEvent): void => undefined
      onload = (): void => undefined
      onerror = (): void => undefined
      onabort = (): void => undefined
      responseText = '{"ok":true}'
      status = 200
      statusText = 'OK'
      responseType = ''
      constructor() { FakeXHR.instance = this }
      open(): void {}
      setRequestHeader(): void {}
      getAllResponseHeaders(): string { return 'content-type: application/json' }
      send(): void {
        this.upload.onprogress(new ProgressEvent('progress', { lengthComputable: true, loaded: 5, total: 10 }))
        this.onprogress(new ProgressEvent('progress', { lengthComputable: true, loaded: 10, total: 10 }))
        this.onload()
      }
      abort(): void { this.onabort() }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const uploads: number[] = []
    const downloads: number[] = []
    const response = await createHTTPClient({ adapter: createXHRAdapter() }).post<{ ok: boolean }>('/upload', { file: 'data' }, {
      onUploadProgress: event => uploads.push(event.percent ?? -1),
      onDownloadProgress: event => downloads.push(event.percent ?? -1)
    })

    expect(response.data).toEqual({ ok: true })
    expect(uploads).toEqual([50])
    expect(downloads).toEqual([100])
    expect(FakeXHR.instance).toBeDefined()
  })

  it('httpPlugin 将 HTTPClient 注入应用', () => {
    const client = createHTTPClient()
    let injected: HTTPClient | undefined
    const app = createVobs({
      render: () => createText('http'),
      plugins: [
        httpPlugin({ client }),
        {
          name: 'consumer',
          install(context) {
            injected = context.inject(HTTP_KEY)
          }
        }
      ]
    })

    app.destroy()
    expect(injected).toBe(client)
  })

  it('请求诊断事件保留显式路由和导航上下文', async () => {
    const events: import('./debug').HTTPDebugRequest[] = []
    const stop = subscribeHTTPDebug(event => events.push(event))
    const client = createHTTPClient({
      adapter: async () => new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    await client.get('/users', {
      debugContext: { route: '/users', navigationId: 7, environment: 'client' }
    })
    stop()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ phase: 'start', context: { route: '/users', navigationId: 7 } })
    expect(events[1]).toMatchObject({ phase: 'end', status: 'success', context: { environment: 'client' } })
  })

  it('重试诊断事件继承显式请求上下文', async () => {
    let attempts = 0
    const events: import('./debug').HTTPDebugRequest[] = []
    const stop = subscribeHTTPDebug(event => events.push(event))
    const client = createHTTPClient({
      retry: 1,
      adapter: async () => {
        attempts++
        return new Response('{}', { status: attempts === 1 ? 503 : 200 })
      }
    })

    await client.get('/retry-context', { debugContext: { route: '/retry-context', navigationId: 9 } })
    stop()
    expect(events.map(event => event.status)).toEqual(['loading', 'retrying', 'success'])
    expect(events[1]).toMatchObject({ phase: 'retry', context: { route: '/retry-context', navigationId: 9 } })
  })
})
