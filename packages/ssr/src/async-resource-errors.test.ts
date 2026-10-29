import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient } from '@vobs/resource'
import { renderToStringAsync } from './render'

/*
 * `prefetchAll()` deliberately does not throw (one failed request must not 500 the whole
 * page), and `dehydrate()` strips out failed entries — so the server would **quietly return
 * HTML rendered from incomplete data**. This pins down "failures must be visible to the
 * server": when non-empty, the `renderToStringAsync` result carries `failedResources` (a
 * snapshot of `ResourceClient.errors()`).
 */
describe('async SSR reports failed resources', () => {
  it('carries failedResources when resources fail (with key and error)', async () => {
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

  it('omits the field when no resources fail (existing result shape unchanged)', async () => {
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
