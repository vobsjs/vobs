import { createInjectionKey, type VobsPlugin } from '@vobs/vobs'
import axios from 'axios'
export { createSSE, createWebSocket } from './stream'
import { emitHTTPDebug } from './debug'
import { getRuntimeDebugContext } from '@vobs/runtime'

export { emitHTTPDebug, getHTTPDebugHooks, setHTTPDebugHooks, subscribeHTTPDebug } from './debug'
export type { HTTPDebugCacheStatus, HTTPDebugContext, HTTPDebugHooks, HTTPDebugRequest, HTTPDebugStatus } from './debug'
export type {
  SSEClient,
  SSEConstructor,
  SSEOptions,
  WebSocketClient,
  WebSocketConstructor,
  WebSocketEventListener,
  WebSocketEventName,
  WebSocketOptions,
  WebSocketState
} from './stream'

export type HTTPMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT'
export type HTTPResponseType = 'arrayBuffer' | 'blob' | 'json' | 'response' | 'text'
export type HTTPHeaders = Record<string, string>
export type RetryDelay = number | ((attempt: number, error: Error) => number)
export interface HTTPProgress {
  readonly loaded: number
  readonly total: number | undefined
  readonly percent: number | undefined
}
export type HTTPProgressHandler = (progress: HTTPProgress) => void
const PROGRESS_HANDLED = Symbol('vobs.http.progress-handled')
let nextHTTPDebugId = 1

export interface RequestOptions {
  url: string
  method?: HTTPMethod
  baseURL?: string
  headers?: HeadersInit
  params?: Record<string, unknown> | URLSearchParams
  body?: unknown
  signal?: AbortSignal
  /** @deprecated Use signal. */
  state?: AbortSignal
  timeout?: number
  retry?: number
  retryDelay?: RetryDelay
  shouldRetry?: (error: Error, attempt: number) => boolean | PromiseLike<boolean>
  cache?: RequestCache
  credentials?: RequestCredentials
  mode?: RequestMode
  responseType?: HTTPResponseType
  onUploadProgress?: HTTPProgressHandler
  onDownloadProgress?: HTTPProgressHandler
  /** Share an in-flight request with the same dedupe key. */
  dedupe?: boolean
  dedupeKey?: string
  /** Optional context copied into DevTools request traces. */
  debugContext?: import('./debug').HTTPDebugContext
}

export interface RequestConfig extends Omit<RequestOptions, 'headers' | 'method'> {
  readonly method: HTTPMethod
  headers: HTTPHeaders
  readonly url: string
}

export interface HTTPResponse<T = unknown> {
  readonly data: T
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly config: RequestConfig
  readonly raw: Response | null
}

/** Adapt an HTTP request to the fetcher contract used by Resource. */
export type HTTPResourceRequest<T> = (
  signal: AbortSignal
) => HTTPResponse<T> | PromiseLike<HTTPResponse<T>>

export function toResourceFetcher<T>(request: HTTPResourceRequest<T>): (signal: AbortSignal) => Promise<T> {
  return signal => Promise.resolve()
    .then(() => request(signal))
    .then(response => response.data)
}

export type HTTPAdapter = (
  config: RequestConfig
) => Response | HTTPResponse<unknown> | PromiseLike<Response | HTTPResponse<unknown>>

export interface AxiosResponseLike<T = unknown> {
  readonly data: T
  readonly status: number
  readonly statusText?: string
  readonly headers?: HeadersInit
  readonly raw?: Response | null
}

export type AxiosRequestConfigLike = RequestConfig & { readonly data?: unknown }
export type AxiosRequest = <T = unknown>(config: AxiosRequestConfigLike) => PromiseLike<AxiosResponseLike<T>>

/** Bridges an Axios request function while preserving HTTPResponse<T>.data typing. */
export function createAxiosAdapter(request: AxiosRequest = builtInAxiosRequest): HTTPAdapter {
  return async config => {
    // normalizeRequest has already serialized params into config.url. Omit
    // params before invoking a custom Axios request so spreading this config
    // into axios.request cannot append the query string a second time.
    const { params: _params, ...requestConfig } = config
    const response = await request<unknown>({ ...requestConfig, data: config.body })
    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText ?? '',
      headers: new Headers(response.headers),
      config,
      raw: response.raw ?? null
    }
  }
}

/**
 * Creates an adapter for deterministic local handlers and test transports.
 * Returning a Response or HTTPResponse keeps full control over status and
 * headers; any other value becomes a successful 200 payload.
 */
export function createMockAdapter(
  handler: (config: RequestConfig) => unknown | PromiseLike<unknown>
): HTTPAdapter {
  return async config => {
    const result = await handler(config)
    if (isResponse(result) || isHTTPResponse(result)) return result
    return {
      data: result,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      config,
      raw: null
    }
  }
}

/** XMLHttpRequest adapter for upload and download progress events. */
export function createXHRAdapter(): HTTPAdapter {
  return config => new Promise<Response>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new Error('HTTP: no XMLHttpRequest available in the current environment'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open(config.method, config.url, true)
    if (config.responseType === 'arrayBuffer') xhr.responseType = 'arraybuffer'
    else if (config.responseType === 'blob') xhr.responseType = 'blob'
    const signal = config.signal ?? config.state
    const abort = (): void => xhr.abort()
    if (signal?.aborted) {
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      return
    }
    const cleanup = (): void => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    xhr.upload.onprogress = event => config.onUploadProgress?.(toProgress(event.loaded, event.lengthComputable ? event.total : undefined))
    xhr.onprogress = event => config.onDownloadProgress?.(toProgress(event.loaded, event.lengthComputable ? event.total : undefined))
    xhr.onload = () => {
      cleanup()
      const headers = new Headers()
      xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
        const separator = line.indexOf(':')
        if (separator > 0) headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
      })
      const body = config.responseType === 'arrayBuffer' || config.responseType === 'blob'
        ? xhr.response
        : xhr.responseText
      const response = new Response(body, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers
      })
      Object.defineProperty(response, PROGRESS_HANDLED, { value: true })
      resolve(response)
    }
    xhr.onerror = () => { cleanup(); reject(new Error('HTTP: XMLHttpRequest network error')) }
    xhr.onabort = () => {
      cleanup()
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    }
    try {
      const headers = new Headers(config.headers)
      const body = encodeBody(config.body, headers, config.method)
      headers.forEach((value, key) => xhr.setRequestHeader(key, value))
      xhr.send((body ?? null) as Document | XMLHttpRequestBodyInit | null)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

/** Explicit fetch transport for applications that do not want the built-in Axios transport. */
export function createFetchAdapter(): HTTPAdapter {
  return fetchAdapter
}

export interface HTTPClientOptions {
  baseURL?: string
  headers?: HeadersInit
  timeout?: number
  adapter?: HTTPAdapter
  retry?: number
  retryDelay?: RetryDelay
  shouldRetry?: (error: Error, attempt: number) => boolean | PromiseLike<boolean>
  concurrency?: number
  dedupe?: boolean
}

export interface InterceptorManager<T> {
  use<TResult = T>(
    onFulfilled?: (value: T) => TResult | PromiseLike<TResult>,
    onRejected?: (error: unknown) => TResult | PromiseLike<TResult>
  ): number
  eject(id: number): void
  clear(): void
}

export interface HTTPInterceptors {
  readonly request: InterceptorManager<RequestConfig>
  readonly response: InterceptorManager<HTTPResponse<unknown>>
}

export interface HTTPClient {
  readonly interceptors: HTTPInterceptors
  request<T = unknown>(options: RequestOptions): Promise<HTTPResponse<T>>
  get<T = unknown>(url: string, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
  delete<T = unknown>(url: string, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
  head<T = unknown>(url: string, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
  post<T = unknown>(url: string, body?: unknown, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
  put<T = unknown>(url: string, body?: unknown, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
  patch<T = unknown>(url: string, body?: unknown, options?: Omit<RequestOptions, 'url' | 'method' | 'body'>): Promise<HTTPResponse<T>>
}

export interface ConcurrencyLimiter {
  <T>(task: () => T | PromiseLike<T>): Promise<T>
}

export class HTTPError extends Error {
  readonly status: number
  readonly statusText: string
  readonly data: unknown
  readonly config: RequestConfig
  readonly response: HTTPResponse<unknown>

  constructor(response: HTTPResponse<unknown>) {
    super(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`)
    this.name = 'HTTPError'
    this.status = response.status
    this.statusText = response.statusText
    this.data = response.data
    this.config = response.config
    this.response = response
  }
}

export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT'

  /**
   * The error that was in hand when the timeout hit.
   *
   * When the whole-chain budget expires, the current error is replaced with a TimeoutError —
   * previously the original error was simply lost (report P12: a real ECONNREFUSED turned into a
   * timeout with no cause). Attached here, there is still a lead when investigating.
   */
  readonly cause?: unknown

  constructor(timeout: number, cause?: unknown) {
    super(`HTTP request did not complete within ${timeout}ms`)
    this.name = 'TimeoutError'
    if (cause !== undefined) this.cause = cause
  }
}

export const HTTP_KEY = createInjectionKey<HTTPClient>('vobs.http')

export interface HTTPPluginOptions extends HTTPClientOptions {
  client?: HTTPClient
}

export function createHTTPClient(options: HTTPClientOptions = {}): HTTPClient {
  const defaults = normalizeClientOptions(options)
  const requestInterceptors = createInterceptors<RequestConfig>()
  const responseInterceptors = createInterceptors<HTTPResponse<unknown>>()
  const adapter = options.adapter ?? createAxiosAdapter()
  const limiter = createConcurrencyLimiter(options.concurrency ?? Infinity)
  const pending = new Map<string, Promise<HTTPResponse<unknown>>>()

  async function request<T>(input: RequestOptions): Promise<HTTPResponse<T>> {
    const initial = normalizeRequest(input, defaults)
    const dedupeKey = getDedupeKey(initial, options.dedupe ?? false)
    if (dedupeKey) {
      const existing = pending.get(dedupeKey)
      if (existing) return existing as Promise<HTTPResponse<T>>
      const shared = executeDebugRequest(initial)
      pending.set(dedupeKey, shared)
      void shared.finally(() => pending.delete(dedupeKey)).catch(() => undefined)
      return shared as Promise<HTTPResponse<T>>
    }
    return executeDebugRequest(initial) as Promise<HTTPResponse<T>>
  }

  function executeDebugRequest(initial: RequestConfig): Promise<HTTPResponse<unknown>> {
    const id = nextHTTPDebugId++
    const startedAt = Date.now()
    const context = {
      ...getRuntimeDebugContext(),
      ...initial.debugContext
    }
    emitHTTPDebug({
      id,
      phase: 'start',
      status: 'loading',
      url: initial.url,
      method: initial.method,
      headers: debugHeaders(initial.headers),
      requestBody: debugValue(initial.body),
      startedAt,
      attempt: 0,
      retries: 0,
      context: Object.keys(context).length > 0 ? context : undefined
    })
    return executeRequest(initial, id).then(response => {
      const endedAt = Date.now()
      emitHTTPDebug({
        id,
        phase: 'end',
        status: 'success',
        url: response.config.url,
        method: response.config.method,
        headers: debugHeaders(response.config.headers),
        requestBody: debugValue(response.config.body),
        startedAt,
        endedAt,
        duration: endedAt - startedAt,
        attempt: 0,
        retries: 0,
        responseStatus: response.status,
        responseBody: debugValue(response.data),
        context: Object.keys(context).length > 0 ? context : undefined
      })
      return response
    }, error => {
      const endedAt = Date.now()
      const cancelled = isAbortError(error)
      emitHTTPDebug({
        id,
        phase: 'end',
        status: cancelled ? 'cancelled' : 'error',
        url: initial.url,
        method: initial.method,
        headers: debugHeaders(initial.headers),
        requestBody: debugValue(initial.body),
        startedAt,
        endedAt,
        duration: endedAt - startedAt,
        attempt: 0,
        retries: 0,
        responseStatus: error instanceof HTTPError ? error.status : undefined,
        responseBody: error instanceof HTTPError ? debugValue(error.data) : undefined,
        error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) },
        context: Object.keys(context).length > 0 ? context : undefined
      })
      throw error
    })
  }

  async function executeRequest(initial: RequestConfig, debugId?: number): Promise<HTTPResponse<unknown>> {
    const requestChain = requestInterceptors.handlers()
    const responseChain = responseInterceptors.handlers().reverse()

    let chain: Promise<unknown> = Promise.resolve(initial)
    for (const handler of requestChain) {
      chain = chain.then(handler.onFulfilled, handler.onRejected)
    }
    chain = chain.then(config => limiter(() => executeWithRetry(config as RequestConfig, adapter, debugId)))
    for (const handler of responseChain) {
      chain = chain.then(handler.onFulfilled, handler.onRejected)
    }
    return chain as Promise<HTTPResponse<unknown>>
  }

  function method<T>(methodName: HTTPMethod, url: string, input: Omit<RequestOptions, 'url' | 'method' | 'body'> = {}): Promise<HTTPResponse<T>> {
    return request<T>({ ...input, url, method: methodName })
  }

  function methodWithBody<T>(methodName: HTTPMethod, url: string, body: unknown, input: Omit<RequestOptions, 'url' | 'method' | 'body'> = {}): Promise<HTTPResponse<T>> {
    return request<T>({ ...input, url, method: methodName, body })
  }

  const client: HTTPClient = {
    interceptors: {
      request: requestInterceptors,
      response: responseInterceptors
    },
    request,
    get: (url, input) => method('GET', url, input),
    delete: (url, input) => method('DELETE', url, input),
    head: (url, input) => method('HEAD', url, input),
    post: (url, body, input) => methodWithBody('POST', url, body, input),
    put: (url, body, input) => methodWithBody('PUT', url, body, input),
    patch: (url, body, input) => methodWithBody('PATCH', url, body, input)
  }
  return client

  async function executeWithRetry(config: RequestConfig, requestAdapter: HTTPAdapter, debugId?: number): Promise<HTTPResponse<unknown>> {
    const controller = new AbortController()
    const inputSignal = config.signal ?? config.state
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const abortFromInput = (): void => controller.abort(inputSignal?.reason)

    if (inputSignal) {
      if (inputSignal.aborted) controller.abort(inputSignal.reason)
      else inputSignal.addEventListener('abort', abortFromInput, { once: true })
    }
    if (config.timeout !== undefined && config.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, config.timeout)
    }

    const adapterConfig: RequestConfig = { ...config, signal: controller.signal }
    /*
     * Cancellation and timeout must be **hard guarantees** — handing the signal to the adapter is
     * not enough.
     *
     * `HTTPAdapter` is a public extension point and may well never read `config.signal`; the
     * original code did a bare `await requestAdapter(...)`, which made abort merely a "suggestion":
     * an aborted request was still sent out and returned 200, and `timeout: 10` only reached the
     * timeout decision once the adapter settled on its own (measured: succeeded only after 74ms).
     * Worse, with an adapter that never settles: the promise stays pending forever (the concurrency
     * gate stays occupied, dedupe on the same key hangs forever).
     *
     * So abort races the adapter — the request promise is guaranteed to settle.
     */
    let rejectOnAbort: ((reason: unknown) => void) | undefined
    /** Errors reported by the adapter itself (survives as the cause even when it loses the race). */
    let lastError: unknown
    const aborted = new Promise<never>((_, reject) => { rejectOnAbort = reject })
    // Empty catch: with no one attached it must not turn into an unhandledRejection (a pit fixed before)
    aborted.catch(() => {})
    const abortError = (): Error => {
      const reason = controller.signal.reason
      if (reason instanceof Error) return reason
      const error = new Error('Vobs HTTP: request was cancelled')
      error.name = 'AbortError'
      return error
    }
    const onAbort = (): void => { rejectOnAbort?.(abortError()) }
    if (controller.signal.aborted) onAbort()
    else controller.signal.addEventListener('abort', onAbort, { once: true })

    let attempt = 0
    try {
      while (true) {
        try {
          /*
           * Keep the adapter's promise in its own variable: if it loses the race (abort arrives
           * first) it may still reject later — with no one attached that becomes an
           * unhandledRejection. Attach an empty catch here, and also record it into lastError so
           * the timeout path can keep it as the cause (the real failure reason must not be lost).
           */
          // The adapter is allowed to return synchronously, so normalize to a promise first
          const adapterPromise = Promise.resolve(requestAdapter(adapterConfig))
          adapterPromise.catch(reason => { lastError = reason })
          const result = await Promise.race([adapterPromise, aborted])
          const response = isHTTPResponse(result)
            ? result
            : await parseResponse(result, adapterConfig)
          if (response.status < 200 || response.status >= 300) throw new HTTPError(response)
          return response
        } catch (error) {
          /*
           * Only attach errors **reported by the adapter itself**.
           *
           * The timeout's abort usually arrives first, at which point lastError is still empty —
           * so **no cause** is attached, rather than stuffing the internally synthesized abort
           * error in as a lead (that is more misleading than nothing).
           * If the real error was reported before the timeout, it is kept here.
           */
          if (timedOut) throw new TimeoutError(config.timeout!, lastError)
          if (inputSignal?.aborted || isAbortError(error)) throw error
          const nextAttempt = attempt + 1
          if (nextAttempt > (config.retry ?? 0)) throw toError(error)
          /*
           * By default, only **idempotent** methods are retried automatically.
           *
           * The original default was `isRetryable(error)`, ignoring the method entirely — the
           * client-level `retry: 2` recommended by the README would really send a POST three times
           * under 503 (measured in the report). The server could then write twice: a silent
           * duplicate submission. The HTTP-client convention is "automatic retries only for
           * idempotent methods".
           *
           * Once the caller provides `shouldRetry` explicitly, it is handed full control — anyone
           * who needs POST retried opts in explicitly; the `retry` budget itself is unchanged.
           */
          const shouldRetry = config.shouldRetry
            ? await config.shouldRetry(toError(error), nextAttempt)
            : isRetryable(error) && isIdempotentMethod(config.method)
          if (!shouldRetry) throw toError(error)
          attempt = nextAttempt
          const retryContext = {
            ...getRuntimeDebugContext(),
            ...config.debugContext
          }
          emitHTTPDebug({
            id: debugId ?? 0,
            phase: 'retry',
            status: 'retrying',
            url: config.url,
            method: config.method,
            headers: debugHeaders(config.headers),
            requestBody: debugValue(config.body),
            startedAt: Date.now(),
            attempt,
            retries: attempt,
            error: { name: toError(error).name, message: toError(error).message },
            context: Object.keys(retryContext).length > 0 ? retryContext : undefined
          })
          /*
           * Backoff takes the **larger** of the two:
           * - the configured `retryDelay` (default 0, i.e. "no extra wait")
           * - the server's `Retry-After` (when present it must be honored; see serverRetryDelay)
           *
           * Taking the larger value instead of "prefer the server's": when the caller explicitly
           * configured a longer backoff, the server must not be allowed to shorten it.
           */
          const serverHint = serverRetryDelay(toError(error))
          const configured = resolveRetryDelay(config.retryDelay ?? 0, attempt, toError(error))
          const delay = Math.max(configured, serverHint ?? 0)
          if (delay > 0) await wait(delay)
        }
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      inputSignal?.removeEventListener('abort', abortFromInput)
    }
  }
}

function debugHeaders(headers: HTTPHeaders): HTTPHeaders {
  const safe: HTTPHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|cookie|token|password|secret|api[-_]?key/i.test(key)) continue
    safe[key] = value
  }
  return safe
}

function debugValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === undefined) return undefined
  if (depth >= 2) return '[MaxDepth]'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.slice(0, 20).map(item => debugValue(item, depth + 1))
  try {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [key, debugValue(item, depth + 1)]))
  } catch {
    return '[Uninspectable]'
  }
}

export function httpPlugin(options: HTTPPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/http',
    version: '0.1.0',
    install(context) {
      const client = options.client ?? createHTTPClient(options)
      context.provide(HTTP_KEY, client)
    }
  }
}

function createInterceptors<T>(): InterceptorManager<T> & {
  handlers(): Array<{ onFulfilled: (value: unknown) => unknown; onRejected: (error: unknown) => unknown }>
} {
  type Handler = {
    onFulfilled: (value: unknown) => unknown
    onRejected: (error: unknown) => unknown
  }
  const entries: Array<Handler | null> = []

  return {
    use(
      onFulfilled?: (value: T) => unknown | PromiseLike<unknown>,
      onRejected?: (error: unknown) => unknown | PromiseLike<unknown>
    ) {
      entries.push({
        onFulfilled: (value: unknown) => onFulfilled ? onFulfilled(value as T) : value,
        onRejected: (error: unknown) => onRejected ? onRejected(error) : Promise.reject(error)
      })
      return entries.length - 1
    },
    eject(id) {
      if (id >= 0 && id < entries.length) entries[id] = null
    },
    clear() {
      entries.fill(null)
    },
    handlers() {
      return entries.filter((entry): entry is Handler => entry !== null)
    }
  }
}

function normalizeClientOptions(options: HTTPClientOptions): Required<Pick<HTTPClientOptions, 'baseURL' | 'headers' | 'timeout' | 'retry' | 'retryDelay'>> & Pick<HTTPClientOptions, 'shouldRetry'> {
  return {
    baseURL: options.baseURL ?? '',
    headers: options.headers ?? {},
    timeout: validateTimeout(options.timeout ?? 0),
    retry: validateRetry(options.retry ?? 0),
    retryDelay: options.retryDelay ?? 0,
    shouldRetry: options.shouldRetry
  }
}

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
  if (limit !== Infinity && (!Number.isFinite(limit) || limit < 1 || !Number.isInteger(limit))) {
    throw new Error('HTTP: concurrency must be an integer >= 1')
  }
  let active = 0
  const queue: Array<() => void> = []

  return <T>(task: () => T | PromiseLike<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = (): void => {
      active++
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active--
        queue.shift()?.()
      })
    }
    if (active < limit) run()
    else queue.push(run)
  })
}

function getDedupeKey(config: RequestConfig, defaultEnabled: boolean): string | undefined {
  if (config.dedupe === false) return undefined
  if (config.dedupeKey) return config.dedupeKey
  if (!(config.dedupe ?? defaultEnabled)) return undefined
  if (config.method !== 'GET' && config.method !== 'HEAD') return undefined
  /*
   * The key must carry the credentials of "who is asking".
   *
   * The original key was just `METHOD url`: two concurrent GETs with the same URL were merged,
   * **even with different Authorization headers** — B's request was never sent at all and B got A's
   * response directly (wrong data, a security issue).
   * Only credential-class headers participate; other headers do not, so dedupe's value is unaffected.
   *
   * It must also carry the options that **change the response shape** (`responseShapeFingerprint`):
   * when the same URL concurrently asks for `responseType:'json'` and `'blob'`, the latter would
   * receive the former's already-parsed object (wrong type and wrong content, and completely
   * silent — dedupe means "share the same response", not "share the same request").
   */
  return `${config.method} ${config.url} ${credentialFingerprint(config.headers)} ${responseShapeFingerprint(config)}`
}

/**
 * The "response shape" options that participate in the dedupe key.
 *
 * These options do not change where the request goes, but they **change what is returned to the
 * caller**, so different declared shapes must not be merged:
 * - `responseType`: json / text / blob / arrayBuffer / response — the biggest difference
 * - `credentials`: include vs omit can return different content (signed-in vs anonymous responses
 *   can differ completely)
 * - `cache`: default vs no-store can return different freshness
 *
 * **Deliberately excluded**: `onDownloadProgress` / `onUploadProgress` / `signal` / `timeout` /
 * `debugContext` / `retry` etc. — they do not affect the response content, only "how we wait".
 *
 * ⚠️ But know that the `onDownloadProgress` trade-off has a cost: if two callers declare
 * **different** progress callbacks yet share the same key, only the first-issued one's progress
 * callback gets called (the latter silently receives no progress). This is written as a comment
 * rather than folded into the key — putting callbacks into the key would make "every new callback
 * produce a new request", completely defeating dedupe. Callers needing independent progress
 * callbacks should use `dedupe: false` or a custom `dedupeKey`.
 */
function responseShapeFingerprint(config: RequestConfig): string {
  return [
    `rt=${config.responseType ?? 'json'}`,
    `cr=${config.credentials ?? 'same-origin'}`,
    `ca=${config.cache ?? 'default'}`
  ].join(' ')
}

/** Credential headers that participate in the dedupe key (lowercase). */
const DEDUPE_CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'] as const

function credentialFingerprint(headers: RequestConfig['headers']): string {
  if (!headers) return ''
  const parts: string[] = []
  // for...in instead of Object.keys: headers may carry prototype members (hit during the table round)
  for (const key in headers) {
    const lower = key.toLowerCase()
    if (!(DEDUPE_CREDENTIAL_HEADERS as readonly string[]).includes(lower)) continue
    const value = (headers as Record<string, unknown>)[key]
    parts.push(`${lower}=${typeof value === 'string' ? value : JSON.stringify(value ?? null)}`)
  }
  return parts.sort().join('&')
}

function normalizeRequest(input: RequestOptions, defaults: ReturnType<typeof normalizeClientOptions>): RequestConfig {
  if (!input.url) throw new Error('HTTP: url must not be empty')
  const method = (input.method ?? 'GET').toUpperCase() as HTTPMethod
  const timeout = validateTimeout(input.timeout ?? defaults.timeout)
  const retry = validateRetry(input.retry ?? defaults.retry)
  const retryDelay = input.retryDelay ?? defaults.retryDelay
  const signal = input.signal ?? input.state
  if (input.signal && input.state && input.signal !== input.state) {
    throw new Error('HTTP: signal and state must not point to different AbortSignals')
  }
  return {
    ...input,
    url: appendParams(resolveURL(input.url, input.baseURL ?? defaults.baseURL), input.params),
    method,
    headers: toHeaders(defaults.headers, input.headers),
    timeout,
    retry,
    retryDelay,
    shouldRetry: input.shouldRetry ?? defaults.shouldRetry,
    signal
  }
}

async function fetchAdapter(config: RequestConfig): Promise<Response> {
  if (typeof fetch !== 'function') throw new Error('HTTP: no fetch available in the current environment')
  const headers = new Headers(config.headers)
  const body = encodeBody(config.body, headers, config.method)
  return fetch(config.url, {
    method: config.method,
    headers,
    body,
    signal: config.signal,
    cache: config.cache,
    credentials: config.credentials,
    mode: config.mode
  })
}

async function parseResponse(response: Response, config: RequestConfig): Promise<HTTPResponse<unknown>> {
  const data = config.responseType === 'response'
    ? response
    : await parseBody(response, config.responseType, hasHandledProgress(response) ? undefined : config.onDownloadProgress)
  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config,
    raw: response
  }
}

const builtInAxiosRequest: AxiosRequest = async <T = unknown>(config: AxiosRequestConfigLike) => {
  const responseType = config.responseType === 'response' ? 'arraybuffer' : toAxiosResponseType(config.responseType)
  const response = await axios.request<T>({
    url: config.url,
    method: config.method,
    headers: config.headers,
    data: config.method === 'GET' || config.method === 'HEAD' ? undefined : config.body,
    signal: config.signal,
    timeout: config.timeout,
    responseType,
    withCredentials: toAxiosCredentials(config.credentials),
    validateStatus: () => true,
    adapter: 'fetch',
    fetchOptions: compactFetchOptions(config),
    onUploadProgress: event => config.onUploadProgress?.(toAxiosProgress(event.loaded, event.total)),
    onDownloadProgress: event => config.onDownloadProgress?.(toAxiosProgress(event.loaded, event.total))
  })
  const raw = config.responseType === 'response'
    ? toRawResponse(response.data, response.status, response.statusText, response.headers as unknown as HeadersInit)
    : null
  return {
    data: (raw ?? response.data) as T,
    status: response.status,
    statusText: response.statusText,
    headers: (typeof response.headers?.toJSON === 'function' ? response.headers.toJSON() : response.headers) as HeadersInit,
    raw
  }
}

/** Methods that are safe to retry automatically: repeating the call is equivalent to calling once. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

function isIdempotentMethod(method: string | undefined): boolean {
  return IDEMPOTENT_METHODS.has((method ?? 'GET').toUpperCase())
}
function toAxiosCredentials(credentials?: RequestCredentials): boolean | undefined {
  if (credentials === 'include') return true
  if (credentials === 'omit') return false
  return undefined
}

function toRawResponse(data: unknown, status: number, statusText: string | undefined, headers: HeadersInit | undefined): Response {
  if (typeof Response === 'undefined') throw new Error('HTTP: no Response available in the current environment')
  const body = status === 204 || status === 205 ? null : data as BodyInit | null | undefined
  return new Response(body, {
    status,
    statusText: statusText ?? '',
    headers: new Headers(headers)
  })
}

function toAxiosResponseType(responseType?: HTTPResponseType): 'arraybuffer' | 'blob' | 'json' | 'text' | undefined {
  if (responseType === 'arrayBuffer') return 'arraybuffer'
  if (responseType === 'response') return undefined
  return responseType
}

function compactFetchOptions(config: RequestConfig): Record<string, unknown> | undefined {
  const options = {
    cache: config.cache,
    credentials: config.credentials,
    mode: config.mode
  }
  const entries = Object.entries(options).filter(([, value]) => value !== undefined)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function toAxiosProgress(loaded: number, total: number | undefined): HTTPProgress {
  return {
    loaded,
    total,
    percent: total && total > 0 ? loaded / total * 100 : undefined
  }
}

async function parseBody(
  response: Response,
  responseType?: HTTPResponseType,
  onDownloadProgress?: HTTPProgressHandler
): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null
  const bytes = onDownloadProgress && response.body
    ? await readResponseBytes(response, onDownloadProgress)
    : undefined
  if (responseType === 'blob') return bytes ? new Blob([bytes as unknown as BlobPart]) : response.blob()
  if (responseType === 'arrayBuffer') return bytes ? bytes.buffer : response.arrayBuffer()
  const text = bytes ? new TextDecoder().decode(bytes) : await response.text()
  if (responseType === 'text') return text
  if (!text) return null
  if (responseType === 'json' || response.headers.get('content-type')?.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('HTTP: response is not valid JSON')
    }
  }
  return text
}

async function readResponseBytes(response: Response, onProgress: HTTPProgressHandler): Promise<Uint8Array> {
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  const totalHeader = response.headers.get('content-length')
  const parsedTotal = totalHeader ? Number(totalHeader) : NaN
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : undefined
  let loaded = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    chunks.push(next.value)
    loaded += next.value.byteLength
    onProgress(toProgress(loaded, total))
  }
  const result = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function isHTTPResponse(value: unknown): value is HTTPResponse<unknown> {
  return typeof value === 'object' && value !== null && 'data' in value && 'status' in value && 'config' in value
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response
}

function hasHandledProgress(response: Response): boolean {
  return Boolean((response as Response & { [PROGRESS_HANDLED]?: boolean })[PROGRESS_HANDLED])
}

function encodeBody(body: unknown, headers: Headers, method: HTTPMethod): BodyInit | undefined {
  if (body === undefined || body === null || method === 'GET' || method === 'HEAD') return undefined
  if (typeof body === 'string' || body instanceof Blob || body instanceof FormData
    || body instanceof ArrayBuffer || body instanceof URLSearchParams) return body as BodyInit
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return JSON.stringify(body)
}

function toHeaders(...inputs: Array<HeadersInit | undefined>): HTTPHeaders {
  const headers = new Headers()
  for (const input of inputs) {
    if (!input) continue
    new Headers(input).forEach((value, key) => headers.set(key, value))
  }
  const result: HTTPHeaders = {}
  headers.forEach((value, key) => { result[key] = value })
  return result
}

function resolveURL(url: string, baseURL: string): string {
  if (!baseURL || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return url
  if (!baseURL) return url
  return `${baseURL.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
}

function appendParams(url: string, params?: Record<string, unknown> | URLSearchParams): string {
  if (!params) return url
  const query = params instanceof URLSearchParams ? params : toSearchParams(params)
  const serialized = query.toString()
  if (!serialized) return url
  return `${url}${url.includes('?') ? '&' : '?'}${serialized}`
}

function toSearchParams(params: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else if (typeof value === 'object') {
      search.set(key, JSON.stringify(value))
    } else {
      search.set(key, String(value))
    }
  }
  return search
}

function isRetryable(error: unknown): boolean {
  return error instanceof HTTPError
    ? error.status === 429 || error.status >= 500
    : !isAbortError(error)
}

function isAbortError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object'
    && ((error as { name?: unknown }).name === 'AbortError'
      || (error as { code?: unknown }).code === 'ERR_CANCELED')
}

function resolveRetryDelay(retryDelay: RetryDelay, attempt: number, error: Error): number {
  const delay = typeof retryDelay === 'function' ? retryDelay(attempt, error) : retryDelay
  if (!Number.isFinite(delay) || delay < 0) throw new Error('HTTP: retryDelay must be a finite number >= 0')
  return delay
}

/**
 * The server's **retry hint** in the response (`Retry-After`); returns undefined when absent.
 *
 * Why it must be honored: a `Retry-After` on `429`/`503` is the server explicitly saying
 * "**not right now**". Retrying in a tight loop with zero backoff throws that rejected traffic
 * right back at the server — an **amplifier** — and violates the protocol: ignore it and the
 * client keeps hammering exactly when the server said "not right now".
 *
 * Two legal formats are supported (RFC 9110 §10.2.3):
 * - seconds: `Retry-After: 5`
 * - HTTP date: `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`
 *
 * Only **non-negative finite values** are accepted; invalid values count as absent (a server's
 * malformed header must not block retries).
 * The 60-second cap: prevents an absurd `Retry-After` from hanging the caller indefinitely.
 */
const MAX_SERVER_RETRY_DELAY = 60_000

function serverRetryDelay(error: Error): number | undefined {
  if (!(error instanceof HTTPError)) return undefined
  const raw = error.response?.headers?.get('retry-after')
  if (raw === null || raw === undefined) return undefined
  const value = raw.trim()
  if (value === '') return undefined

  let ms: number | undefined
  if (/^\d+$/u.test(value)) {
    ms = Number(value) * 1000
  } else {
    const when = Date.parse(value)
    if (!Number.isNaN(when)) ms = when - Date.now()
  }
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined
  return Math.min(ms, MAX_SERVER_RETRY_DELAY)
}

function validateRetry(retry: number): number {
  if (!Number.isInteger(retry) || retry < 0) throw new Error('HTTP: retry must be an integer >= 0')
  return retry
}

function validateTimeout(timeout: number): number {
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('HTTP: timeout must be a finite number >= 0')
  return timeout
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function wait(delay: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay))
}

function toProgress(loaded: number, total: number | undefined): HTTPProgress {
  return {
    loaded,
    total,
    percent: total && total > 0 ? loaded / total * 100 : undefined
  }
}
