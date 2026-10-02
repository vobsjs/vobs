// @vitest-environment jsdom
/*
 * 去重键必须包含**改变响应形态**的选项。
 *
 * 去重的语义是"共享同一个**响应**"，不是"共享同一个**请求**"。
 * 原来键只有 `METHOD url 凭据头` —— 同一个 URL 并发要 `responseType:'json'` 与 `'blob'` 时，
 * 后者根本不发请求、直接拿到前者解析好的对象：类型与内容都不对，而且**完全无声**。
 *
 * 判据用"适配器被调用几次"（与既有 `dedupe-identity.test.ts` 同一手法）：
 * 形态不同 → 必须各发一次；形态相同 → 必须只发一次。
 */
import { describe, expect, it, vi } from 'vitest'
import { createHTTPClient } from './index'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const jsonResponse = (data: unknown): Response => new Response(JSON.stringify(data), {
  headers: { 'content-type': 'application/json' }
})

/** 可数调用次数的适配器。 */
function countingAdapter(): { calls: () => number; adapter: unknown } {
  const spy = vi.fn(async () => {
    await sleep(5)
    return jsonResponse({ ok: true })
  })
  return { calls: () => spy.mock.calls.length, adapter: spy }
}

describe('http 去重键：响应形态不同不得合并', () => {
  it('responseType 不同 → 各发一次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'blob', dedupe: true })
    ])
    expect(calls(), 'responseType 不同的两个请求被合并了').toBe(2)
  })

  it('credentials 不同 → 各发一次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { credentials: 'include', dedupe: true }),
      client.get('/same', { credentials: 'omit', dedupe: true })
    ])
    expect(calls(), 'credentials 不同的两个请求被合并了').toBe(2)
  })

  it('cache 不同 → 各发一次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { cache: 'default', dedupe: true }),
      client.get('/same', { cache: 'no-store', dedupe: true })
    ])
    expect(calls(), 'cache 不同的两个请求被合并了').toBe(2)
  })

  it('形态完全相同 → 仍然只发一次（去重的价值没被破坏）', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    const [a, b] = await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'json', dedupe: true })
    ])
    expect(calls(), '形态相同的并发请求没有合并').toBe(1)
    expect(a.data).toEqual(b.data)
  })

  it('不写 responseType（默认 json）与显式 json 视为同形态 → 只发一次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { dedupe: true }),
      client.get('/same', { responseType: 'json', dedupe: true })
    ])
    expect(calls(), '默认值与显式值不该被当成不同形态').toBe(1)
  })

  it('凭据头不同仍然各发一次（既有语义没被破坏）', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { headers: { authorization: 'Bearer a' }, dedupe: true }),
      client.get('/same', { headers: { authorization: 'Bearer b' }, dedupe: true })
    ])
    expect(calls(), '凭据不同的两个请求被合并了（安全问题）').toBe(2)
  })

  it('显式 dedupeKey 仍然完全接管（由调用方负责语义）', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/a', { dedupeKey: 'shared', responseType: 'json' }),
      client.get('/b', { dedupeKey: 'shared', responseType: 'blob' })
    ])
    // 显式指定 key 时语义由调用方决定：形态不同也合并（这是它的选择）
    expect(calls()).toBe(1)
  })

  it('dedupe: false 时不合并（不受形态指纹影响）', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { dedupe: false }),
      client.get('/same', { dedupe: false })
    ])
    expect(calls()).toBe(2)
  })

  it('并发三个不同 responseType → 三次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await Promise.all([
      client.get('/same', { responseType: 'json', dedupe: true }),
      client.get('/same', { responseType: 'text', dedupe: true }),
      client.get('/same', { responseType: 'blob', dedupe: true })
    ])
    expect(calls()).toBe(3)
  })

  it('非并发（前一个已结束）本来就各发一次', async () => {
    const { calls, adapter } = countingAdapter()
    const client = createHTTPClient({ adapter: adapter as never })
    await client.get('/same', { responseType: 'json', dedupe: true })
    await client.get('/same', { responseType: 'blob', dedupe: true })
    expect(calls()).toBe(2)
  })
})
