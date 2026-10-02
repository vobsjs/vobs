// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient } from './index'

/*
 * 取消与超时必须是**硬保证**，不是"建议"。
 *
 * `HTTPAdapter` 是公开扩展点，完全可能不读 `config.signal`；而 http 原来直接
 * `await requestAdapter(...)`，从不与 abort 赛跑。后果：已 abort 的请求照样发出并返回 200；
 * `timeout: 10` 要等适配器自己收敛才判超时（报告实测 74ms 才成功）；适配器永不结算时
 * promise 永久 pending（并发闸占死、去重同 key 永挂）。
 *
 * 现在 abort 与适配器赛跑，请求 promise 必定收敛。这些用真定时器 + 小毫秒值，不依赖假定时器。
 */
const slowAdapter = (delay: number) => async () => {
  await new Promise(resolve => setTimeout(resolve, delay))
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('http 取消与超时的硬保证', () => {
  it('timeout 到点即失败，不等适配器自己收敛（原来会等到适配器返回）', async () => {
    /*
     * 不用时间阈值。原来的写法是"适配器 120ms、断言 elapsed < 80ms"，而 timeout 是 15ms ——
     * 机器一忙（例如并发跑别的任务）15ms 的定时器能飘到 80ms 以上，于是**假红**（实测 83ms）。
     * 改成断言"请求结算时适配器还没返回"：这才是"硬保证"的真正含义，且与机器速度完全无关。
     */
    let adapterSettled = false
    const client = createHTTPClient({
      adapter: async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        adapterSettled = true
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    await expect(client.get('/slow', { timeout: 15 })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(adapterSettled, '请求必须在适配器返回之前就失败').toBe(false)
  })

  it('飞行中 abort 会立刻拒绝，而不是拿到 200', async () => {
    const client = createHTTPClient({ adapter: slowAdapter(120) })
    const controller = new AbortController()
    const pending = client.get('/slow', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('适配器永不结算时，abort 也能让 promise 收敛（原来永久 pending）', async () => {
    const client = createHTTPClient({ adapter: () => new Promise<Response>(() => {}) })
    const controller = new AbortController()
    const pending = client.get('/never', { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await expect(promiseWithTimeout(pending, 300)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('正常请求不受影响（赛跑没有改变成功路径）', async () => {
    const client = createHTTPClient({ adapter: slowAdapter(5) })
    const response = await client.get('/ok')
    expect(response.status).toBe(200)
  })
})

function promiseWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`没有在 ${ms}ms 内收敛`)), ms))
  ])
}
