# @vobs/http

HTTP client for vobs with retry, timeout, in-flight dedupe, interceptors, pluggable transports, and signal-based cancellation.

## Install

```bash
npm install @vobs/http
```

## Quick start

```ts
import { createHTTPClient, HTTPError } from '@vobs/http'

const client = createHTTPClient({
  baseURL: '/api',
  timeout: 10_000,
  retry: 2,
  retryDelay: attempt => attempt * 500
})

const { data, status } = await client.get<{ id: number }>('/users/1', {
  params: { expand: 'profile' }
})

await client.post('/users', { name: 'Ada' })

try {
  await client.get('/private')
} catch (error) {
  if (error instanceof HTTPError) console.log(error.status, error.data)
}
```

Non-2xx responses throw `HTTPError` carrying `status`, `data`, and the request `config`. Requests exceeding `timeout` throw `TimeoutError` (code `ETIMEDOUT`) and are not retried. Other failures retry up to `retry` times when `shouldRetry` allows (default: 429 and 5xx), waiting `retryDelay` between attempts. Pass `signal` to cancel a request; `dedupe: true` shares one in-flight GET or HEAD per URL.

## API

| Signature | Description |
| --- | --- |
| `createHTTPClient(options?: HTTPClientOptions): HTTPClient` | Defaults for `baseURL`, `headers`, `timeout`, `retry`, `adapter`, `concurrency`, and `dedupe`. |
| `client.get / delete / head(url, options?)` | Body-less methods returning `HTTPResponse<T>`. |
| `client.post / put / patch(url, body?, options?)` | FormData, Blob, and string bodies pass through; other values are JSON-encoded. |
| `client.request(options)` | Full `RequestOptions` control, including `params`, `responseType`, and progress handlers. |
| `client.interceptors.request / response` | `use / eject / clear`; request interceptors run in order, response interceptors in reverse. |
| `createConcurrencyLimiter(limit): ConcurrencyLimiter` | Queue tasks behind a maximum parallel count. |
| `createFetchAdapter() / createXHRAdapter() / createAxiosAdapter(request?) / createMockAdapter(handler)` | Swap the transport; the XHR adapter adds upload and download progress events. |
| `toResourceFetcher(request)` | Adapt an HTTP request to the `ResourceFetcher` contract of @vobs/resource. |
| `httpPlugin(options?)` | Provide the client as `HTTP_KEY` in a vobs app. |
| `createSSE(url, options?)` | EventSource wrapper exposing `source` and `close()`. |
| `createWebSocket(url, options?)` | WebSocket client with typed `on()` events and optional auto-reconnect. |
| `subscribeHTTPDebug(listener) / setHTTPDebugHooks(hooks) / getHTTPDebugHooks()` | Observe request traces for DevTools; sensitive headers are redacted. |

## Types

HTTPMethod, HTTPResponseType, HTTPHeaders, RetryDelay, HTTPProgress, HTTPProgressHandler, RequestOptions, RequestConfig, HTTPResponse, HTTPResourceRequest, HTTPAdapter, AxiosRequest, AxiosRequestConfigLike, AxiosResponseLike, HTTPClientOptions, HTTPClient, HTTPInterceptors, InterceptorManager, ConcurrencyLimiter, HTTPPluginOptions, HTTPDebugRequest, HTTPDebugStatus, HTTPDebugContext, HTTPDebugHooks, HTTPDebugCacheStatus, SSEClient, SSEConstructor, SSEOptions, WebSocketClient, WebSocketConstructor, WebSocketEventListener, WebSocketEventName, WebSocketOptions, WebSocketState
