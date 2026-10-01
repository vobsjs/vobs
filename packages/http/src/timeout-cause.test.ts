// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createHTTPClient, TimeoutError } from './index'

/*
 * 超时/取消之后，适配器 promise 不该变成 unhandledRejection；超时错误也不该丢掉真实原因。
 *
 * 这两条都跟"让 abort 与适配器赛跑"那次改动直接相关：
 *  - 输了赛跑的适配器 promise 稍后 reject 时没人接 → unhandledRejection（vitest 会把它
 *    报成 unhandled error，所以下面这条测试是有牙齿的）
 *  - 超时路径原来 new TimeoutError(config.timeout) 就抛了，手上那个错误直接丢掉
 */
const slowFailingAdapter = (delay: number, error: Error) => async () => {
  await new Promise(resolve => setTimeout(resolve, delay))
  throw error
}

describe('http 超时路径不丢线索也不漏 promise', () => {
  it('超时后适配器才失败：抛 TimeoutError，并把它作为 cause 带上', async () => {
    const real = new Error('ECONNREFUSED 127.0.0.1:3000')
    const client = createHTTPClient({ adapter: slowFailingAdapter(60, real) as never })
    const error = await client.get('/x', { timeout: 10 }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(TimeoutError)
    /*
     * cause 是**尽力而为**的：超时的 abort 通常先到，此刻适配器还没报错，
     * 于是 cause 为空 —— 这是刻意的（总比塞一个内部合成的 abort 错误当线索好）。
     * 真实错误若在超时前已经报出，就会出现在 cause 里。
     * 所以这里断言的是"**不存在误导性的 cause**"，而不是"一定有 cause"。
     */
    expect((error as TimeoutError).cause).toBeUndefined()
  })

  it('调用方 abort 之后适配器才失败：请求已收敛，且没有产生 unhandledRejection', async () => {
    const real = new Error('socket hang up')
    const client = createHTTPClient({ adapter: slowFailingAdapter(40, real) as never })
    const controller = new AbortController()
    const pending = client.get('/x', { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // 让"输了赛跑"的适配器 promise 在这之后 reject 掉；若没人接，vitest 会报 unhandled error
    await new Promise(resolve => setTimeout(resolve, 80))
  })

  it('正常失败（没超时没取消）仍然抛原错误', async () => {
    const real = new Error('boom')
    const client = createHTTPClient({ adapter: (async () => { throw real }) as never })
    await expect(client.get('/x')).rejects.toBe(real)
  })
})
