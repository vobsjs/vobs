// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hydrate, renderToString } from '@vobs/ssr'
import { bindText, createElement, createText, insertBefore } from '@vobs/vobs'
import { createDevTools } from './index'

/*
 * ssr 会在"水合时临时认领了一个非空文本"时发 `hydrationProvisionalText`（服务端渲染了真实文本、
 * 客户端此刻要空文本，等绑定 effect 覆写 —— 这类"值被悄悄换掉"过去完全无声）。
 * 这条测试钉住 devtools 真的把它接住了：否则那个可观测出口等于没人听。
 */
describe('@vobs/devtools 接住水合的临时认领', () => {
  it('hydrationProvisionalText 记成一条 lifecycle 事件', () => {
    const devtools = createDevTools({ expose: false })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }

    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)

    const events = devtools.getLifecycleEvents().filter(event => event.type === 'hydration-provisional-text')
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toContain('count: 42')

    app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })
})
