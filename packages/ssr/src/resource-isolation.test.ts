import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient, resource, resetDefaultResourceClient } from '@vobs/resource'
import { renderToStringAsync } from './render'

/*
 * `resource()` 的函数式 API 用的是 `@vobs/resource` 的**模块级** client —— 进程级缓存。
 * 服务端每个请求共用同一个模块实例，所以上一轮渲染留下的条目会被下一轮原样复用：
 * 实测探针 `.artifacts/probe-audit-ssr-2.test.mjs` 的 H5/H6，连续渲染「alice」「bob」两个用户，
 * 第二次的产物与 `dehydrate()` 里都是 **alice**、fetcher 只被调用 1 次 ——
 * 也就是把上一位用户的数据随脱水快照发给了下一个页面。
 *
 * 修法：`renderToStringAsync` 在每次渲染的 `finally` 里调 `resetDefaultResourceClient()`。
 * 调用方**自己传入**的 `options.resourceClient` 不动（生命周期归调用方）。
 */
describe('SSR 跨请求不泄漏模块级 resource 缓存', () => {
  /** 每次渲染都按"第几个被调用的请求"返回自己的用户，与真实请求的形状一致。 */
  const userRender = (seen: string[]) => () => {
    const model = resource({
      key: ['current-user'],
      fetcher: async () => {
        const value = seen.length === 0 ? 'alice' : 'bob'
        seen.push(value)
        return value
      }
    })
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => model.data.value ?? 'loading')
    return span
  }

  it('两次渲染各自拿到自己的数据（用模块级 resource()）', async () => {
    resetDefaultResourceClient()
    const seen: string[] = []

    const first = await renderToStringAsync(userRender(seen))
    const second = await renderToStringAsync(userRender(seen))

    expect(first.html).toContain('alice')
    // 修复前这里是 alice（复用上一轮缓存），且 fetcher 只跑一次
    expect(second.html).toContain('bob')
    expect(seen).toEqual(['alice', 'bob'])
  })

  it('每次渲染都打真实取数（模块级缓存不残留到下一轮）', async () => {
    resetDefaultResourceClient()
    const fetches: string[] = []
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      const model = resource({
        key: ['counter'],
        fetcher: async () => {
          fetches.push(`fetch-${fetches.length + 1}`)
          return fetches[fetches.length - 1]
        }
      })
      bindText(text, () => model.data.value ?? 'loading')
      return span
    }

    const first = await renderToStringAsync(render)
    const second = await renderToStringAsync(render)

    // 修复前：第二轮零取数、HTML 与第一轮逐字相同（stale-1）
    expect(first.html).toContain('fetch-1')
    expect(second.html).toContain('fetch-2')
    expect(fetches).toEqual(['fetch-1', 'fetch-2'])
  })

  it('渲染抛错也不把脏缓存留给下一个请求', async () => {
    resetDefaultResourceClient()
    const broken = () => {
      resource({ key: ['current-user'], fetcher: async () => 'alice' })
      throw new Error('boom')
    }

    await expect(renderToStringAsync(broken as never)).rejects.toThrow('boom')

    const seenAfter: string[] = []
    const after = await renderToStringAsync(userRender(seenAfter))
    // 若 finally 里没复位，这里会复用上一轮的 'alice' 且 fetcher 一次都不跑
    expect(after.html).toContain('alice')
    expect(seenAfter).toEqual(['alice'])
  })

  it('调用方传入的 resourceClient 不被复位（生命周期归调用方）', async () => {
    const client = createResourceClient()
    let calls = 0
    const model = client.resource({
      key: ['own'],
      staleTime: 60_000,
      fetcher: async () => { calls += 1; return 'value' }
    })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => model.data.value ?? 'loading')
      return span
    }

    await renderToStringAsync(render, { resourceClient: client })
    await renderToStringAsync(render, { resourceClient: client })

    // 没有任何一个渲染为模块级 client 造过条目，所以模块级复位与本 client 无关；
    // 这里同时证明"传进来的 client 不会被谁顺手 clear 掉"。
    expect(client.get(['own'])?.data).toBe('value')
    client.clear()
  })
})
