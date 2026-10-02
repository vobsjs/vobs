import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient } from '@vobs/resource'
import { renderToStringAsync } from './render'

/*
 * `prefetchAll()` 刻意不抛错（一个请求失败不该让整页 500），而 `dehydrate()` 又会剔除失败项 ——
 * 于是服务端会**安安静静地返回一份用残缺数据渲染的 HTML**。这里把"失败要能被服务端看见"钉住：
 * `renderToStringAsync` 的结果在非空时带上 `failedResources`（`ResourceClient.errors()` 的快照）。
 */
describe('异步 SSR 把失败的资源报出来', () => {
  it('有失败资源时带上 failedResources（含 key 与 error）', async () => {
    const resources = createResourceClient()
    const broken = resources.resource({
      key: ['orders'],
      fetcher: async () => { throw new Error('boom') }
    })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => (broken.error.value ? 'failed' : 'ok'))
      return span
    }

    const result = await renderToStringAsync(render, { resourceClient: resources })

    expect(result.html).toContain('failed')
    expect(result.failedResources).toHaveLength(1)
    expect(result.failedResources?.[0]?.key).toEqual(['orders'])
    expect(result.failedResources?.[0]?.error).toBeInstanceOf(Error)
    resources.clear()
  })

  it('没有失败资源时不带该字段（不改变既有结果形状）', async () => {
    const resources = createResourceClient()
    const healthy = resources.resource({ key: ['health'], fetcher: async () => 'fine' })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => healthy.data.value ?? 'loading')
      return span
    }

    const result = await renderToStringAsync(render, { resourceClient: resources })

    expect(result.html).toContain('fine')
    expect('failedResources' in result).toBe(false)
    resources.clear()
  })
})
