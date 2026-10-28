/*
 * Middleware-behavior tests for the Agent runtime snapshot channel (`/__vobs/agent-state`).
 *
 * The channel pattern is isomorphic to devGuardrails violation reporting (browser probe
 * POST → dev server cache → consumer read), but the consumer is not the terminal — it is
 * **HTTP GET JSON**, the last link in the Agent self-verification loop
 * (generate → pre-write snippet self-check → runtime snapshot query → correction).
 *
 * Four behaviors are locked here: POST lands in cache, GET returns, corrupted payloads
 * are dropped, and the per-page bucket cap.
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

/** Extract the middleware registered by configureServer from the plugin (mocking the used parts of ViteDevServer). */
function setupMiddleware() {
  let handler: (req: unknown, res: unknown, next: () => void) => void = () => undefined
  const wsHandlers = new Map<string, (data: unknown) => void>()
  const wsSend = vi.fn()
  const plugin = vobsPlugin()
  const server = {
    middlewares: { use: (fn: typeof handler) => { handler = fn } },
    config: { logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } },
    ws: {
      send: wsSend,
      on: (event: string, handler: (data: unknown) => void) => { wsHandlers.set(event, handler) }
    }
  }
  ;(plugin.configureServer as (server: unknown) => void)(server)
  return { handler, wsHandlers, wsSend }
}

/** Minimal req/res stub: for POST, the body is fed in via 'data'/'end' events. */
function call(handler: (req: unknown, res: unknown, next: () => void) => void, method: string, url: string, body?: string) {
  return new Promise<{ statusCode: number | undefined; body: string }>(resolve => {
    const chunks: string[] = []
    const req = {
      method,
      url,
      on: (event: string, cb: (chunk?: string) => void) => {
        if (event === 'data' && body !== undefined) cb(body)
        if (event === 'end') cb()
      }
    }
    const res = {
      statusCode: undefined as number | undefined,
      setHeader: vi.fn(),
      end: (text?: string) => {
        chunks.push(text ?? '')
        resolve({ statusCode: res.statusCode, body: chunks.join('') })
      }
    }
    handler(req, res, () => resolve({ statusCode: 999, body: 'next() was called' }))
  })
}

describe('Agent runtime snapshot channel (/__vobs/agent-state)', () => {
  it('POST lands in cache, GET returns the same snapshot (bucketed by page)', async () => {
    const { handler } = setupMiddleware()
    await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({
      page: 'http://localhost:5175/', ts: 1, effects: [{ id: 'effect-1', dependencies: ['signal-1'] }]
    }))
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    expect(get.statusCode).toBe(200)
    const parsed = JSON.parse(get.body) as { pages: { page: string; effects: { id: string }[] }[] }
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]!.page).toBe('http://localhost:5175/')
    expect(parsed.pages[0]!.effects[0]!.id).toBe('effect-1')
  })

  it('a second POST for the same page **replaces** the old snapshot (does not accumulate)', async () => {
    const { handler } = setupMiddleware()
    for (const ts of [1, 2]) {
      await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: 'http://x/', ts }))
    }
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: { ts: number }[] }
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]!.ts).toBe(2)
  })

  it('corrupted JSON payloads are dropped (204, existing snapshots unaffected)', async () => {
    const { handler } = setupMiddleware()
    await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: 'http://x/', ts: 1 }))
    await call(handler, 'POST', '/__vobs/agent-state', '{ broken')
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: { page: string }[] }
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]!.page).toBe('http://x/')
  })

  it('page bucket cap of 20 — keeps multi-tab/polling from exhausting memory', async () => {
    const { handler } = setupMiddleware()
    for (let index = 0; index < 25; index++) {
      await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: `http://x/${index}`, ts: index }))
    }
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: unknown[] }
    expect(parsed.pages.length).toBe(20)
  })

  it('unrelated paths go straight to next() (does not hijack application requests)', async () => {
    const { handler } = setupMiddleware()
    const result = await call(handler, 'GET', '/some/app/route')
    expect(result.body).toBe('next() was called')
  })

  it('GET ?live=1 broadcasts over vite WS and returns a stale:false live snapshot once the browser responds', async () => {
    const { handler, wsHandlers, wsSend } = setupMiddleware()
    const pending = call(handler, 'GET', '/__vobs/agent-state?live=1')
    // The broadcast has been sent (the probe listens for this custom event in the browser)
    expect(wsSend).toHaveBeenCalledWith({ type: 'custom', event: 'vobs:agent-state-request', data: { id: expect.any(Number) } })
    const id = (wsSend.mock.calls[0]![0] as { data: { id: number } }).data.id
    // Simulate the probe responding immediately
    wsHandlers.get('vobs:agent-state:response')!({
      id,
      snapshot: { page: 'http://x/live', ts: Date.now(), effects: [{ id: 'effect-live' }] }
    })
    const result = await pending
    const parsed = JSON.parse(result.body) as { stale: boolean; pages: { page: string }[] }
    expect(parsed.stale).toBe(false)
    expect(parsed.pages[0]!.page).toBe('http://x/live')
  })

  it('live queries time out and fall back to the cache (stale:true) when no browser responds, without hanging', async () => {
    vi.useFakeTimers()
    try {
      const { handler } = setupMiddleware()
      await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: 'http://x/', ts: 1 }))
      const pending = call(handler, 'GET', '/__vobs/agent-state?live=1')
      await vi.advanceTimersByTimeAsync(700)
      const result = await pending
      const parsed = JSON.parse(result.body) as { stale: boolean; pages: { page: string }[] }
      expect(parsed.stale).toBe(true)
      expect(parsed.pages[0]!.page).toBe('http://x/')
    } finally {
      vi.useRealTimers()
    }
  })
})
