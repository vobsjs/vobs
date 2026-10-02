// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/*
 * 水合里最阴的一类差异：服务端渲染了**非空**文本，客户端此刻要的是空文本节点
 * （典型形态是 `createText('')` + 后面用绑定 effect 覆写）—— 只认领、不报错，
 * 于是"服务端 Ada / 客户端忘传 state 渲染 loading"这种值被悄悄换掉的情况完全无声。
 *
 * 第 13 轮给了可观测出口（`hydrationProvisionalText`）；本轮把**语义**补齐：
 * 打开 `strictHydration` 时直接报水合不匹配，默认仍保持原行为（不破坏既有应用）。
 */
describe('水合：临时认领非空文本（strictHydration）', () => {
  const render = () => {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => 'count: 42')
    return span
  }

  it('默认（非严格）：照旧认领并完成水合，行为不变', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    expect(document.body.textContent).toBe('count: 42')
    app.destroy()
    document.body.innerHTML = ''
  })

  it('strictHydration：同一场景直接报水合不匹配（kind=content）', () => {
    document.body.innerHTML = renderToString(render)
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(render, document.body, { strictHydration: true })
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('content')
    expect(error?.vobsHydration?.actual).toContain('count: 42')
    document.body.innerHTML = ''
  })

  it('strictHydration 对"服务端空文本（占位注释）"这种正常形态不误报', () => {
    const renderEmpty = () => {
      const span = createElement('span')
      insertBefore(span, createText(''), null)
      return span
    }
    document.body.innerHTML = renderToString(renderEmpty)
    const app = hydrate(renderEmpty, document.body, { strictHydration: true })
    expect(document.body.querySelector('span')).not.toBeNull()
    app.destroy()
    document.body.innerHTML = ''
  })
})
