import { createHTTPClient, createMockAdapter, httpPlugin } from '@vobs/http'
import { state } from '@vobs/vobs'

export const httpScenario = state<'success' | 'error' | 'slow'>('success', 'playground.http.scenario')
export const uploadScenario = state<'success' | 'error' | 'slow'>('success', 'playground.upload.scenario')
const uploadAttempts = new Map<string, number>()

function waitForMock(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay)
    const abort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Request cancelled'), { name: 'AbortError' }))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export const playgroundHttp = createHTTPClient({
  adapter: createMockAdapter(async config => {
    const isUpload = config.url.includes('/demo/upload')
    const scenario = isUpload ? uploadScenario.value : httpScenario.value
    await waitForMock(config.signal ?? new AbortController().signal, scenario === 'slow' ? 1200 : 180)
    const uploadKey = isUpload && config.body instanceof FormData
      ? String(typeof File !== 'undefined' && config.body.get('file') instanceof File ? (config.body.get('file') as File).name : 'upload')
      : ''
    const attempt = uploadKey ? (uploadAttempts.get(uploadKey) ?? 0) + 1 : 0
    if (uploadKey) uploadAttempts.set(uploadKey, attempt)
    if (scenario === 'error' && (!isUpload || attempt === 1)) {
      return new Response(JSON.stringify({ ok: false, message: isUpload ? 'Upload failed' : 'Request failed' }), {
        status: 500,
        statusText: 'Mock failure',
        headers: { 'content-type': 'application/json' }
      })
    }
    return {
      ok: true,
      method: config.method,
      url: config.url,
      received: config.body instanceof FormData
    }
  })
})

export const httpPluginInstance = httpPlugin({ client: playgroundHttp })
