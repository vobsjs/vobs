/*
 * Agent 运行时快照通道（`/__vobs/agent-state`）的**中间件行为**测试。
 *
 * 通道模式与 devGuardrails 违规上报同构（浏览器探针 POST → dev server 缓存 →
 * 消费面读取），但消费面不是终端而是 **HTTP GET 的 JSON** —— Agent 自验闭环
 * （生成 → 写前 snippet 自检 → 运行时快照查询 → 修正）的最后一环。
 *
 * 这里锁住四条行为：POST 落缓存、GET 返回、损坏载荷丢弃、页面桶上限。
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

/** 从插件里抽出 configureServer 注册的中间件（mock 掉 ViteDevServer 的用到的部分）。 */
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

/** 极简 req/res 桩：POST 时 body 通过 'data'/'end' 事件给入。 */
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

describe('Agent 运行时快照通道（/__vobs/agent-state）', () => {
  it('POST 落缓存，GET 返回同一份快照（按 page 分桶）', async () => {
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

  it('同一 page 的第二次 POST **替换**旧快照（不累积）', async () => {
    const { handler } = setupMiddleware()
    for (const ts of [1, 2]) {
      await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: 'http://x/', ts }))
    }
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: { ts: number }[] }
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]!.ts).toBe(2)
  })

  it('损坏的 JSON 载荷被丢弃（204，不影响已有快照）', async () => {
    const { handler } = setupMiddleware()
    await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: 'http://x/', ts: 1 }))
    await call(handler, 'POST', '/__vobs/agent-state', '{ broken')
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: { page: string }[] }
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.pages[0]!.page).toBe('http://x/')
  })

  it('页面桶上限 20 —— 防多标签页/轮询刷爆内存', async () => {
    const { handler } = setupMiddleware()
    for (let index = 0; index < 25; index++) {
      await call(handler, 'POST', '/__vobs/agent-state', JSON.stringify({ page: `http://x/${index}`, ts: index }))
    }
    const get = await call(handler, 'GET', '/__vobs/agent-state')
    const parsed = JSON.parse(get.body) as { pages: unknown[] }
    expect(parsed.pages.length).toBe(20)
  })

  it('无关路径直接 next()（不劫持应用请求）', async () => {
    const { handler } = setupMiddleware()
    const result = await call(handler, 'GET', '/some/app/route')
    expect(result.body).toBe('next() was called')
  })

  it('GET ?live=1 经 vite WS 广播请求，浏览器应答后返回 stale:false 的实时快照', async () => {
    const { handler, wsHandlers, wsSend } = setupMiddleware()
    const pending = call(handler, 'GET', '/__vobs/agent-state?live=1')
    // 广播已发出（探针在浏览器里监听这个 custom event）
    expect(wsSend).toHaveBeenCalledWith({ type: 'custom', event: 'vobs:agent-state-request', data: { id: expect.any(Number) } })
    const id = (wsSend.mock.calls[0]![0] as { data: { id: number } }).data.id
    // 模拟探针立即回传
    wsHandlers.get('vobs:agent-state:response')!({
      id,
      snapshot: { page: 'http://x/live', ts: Date.now(), effects: [{ id: 'effect-live' }] }
    })
    const result = await pending
    const parsed = JSON.parse(result.body) as { stale: boolean; pages: { page: string }[] }
    expect(parsed.stale).toBe(false)
    expect(parsed.pages[0]!.page).toBe('http://x/live')
  })

  it('live 查询在无浏览器应答时超时回退缓存（stale:true），不挂死', async () => {
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
