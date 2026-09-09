import { createHTTPClient, createMockAdapter, httpPlugin } from '@vobs/http'
import { state } from '@vobs/vobs'
import { waitFor } from '../utils/async'

export const httpScenario = state<'success' | 'error' | 'slow'>('success')
export const uploadScenario = state<'success' | 'error' | 'slow'>('success')
const uploadAttempts = new Map<string, number>()

export const playgroundHttp = createHTTPClient({
  adapter: createMockAdapter(async config => {
    const isUpload = config.url.includes('/demo/upload')
    const scenario = isUpload ? uploadScenario.value : httpScenario.value
    await waitFor(config.signal ?? new AbortController().signal, scenario === 'slow' ? 1200 : 180)
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
