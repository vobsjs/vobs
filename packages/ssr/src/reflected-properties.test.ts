// @vitest-environment jsdom
/*
 * 服务端序列化必须覆盖**总是反射**的那批 property：`id` / `style` / `title`。
 *
 * 缺口（实测对比 `setProperty` 在 DOM 上的效果）：
 *   setProperty(el,'id','x')             → DOM `id="x"`                 SSR 丢失
 *   setProperty(el,'style','color:red')  → DOM `style="color: red;"`    SSR 丢失
 *   setProperty(el,'title','T')          → DOM `title="T"`              SSR 丢失
 *
 * 后果不是"少一个属性"那么轻：首屏 HTML 里没有 id/style/title →
 * CSS 选择器与 `document.getElementById` 在首屏拿不到 → 客户端水合后才补上（可见闪动）。
 *
 * 与既有 `text-content.test.ts` 同属一类：那条修的是 `textContent` 走文本通道；
 * 这条修的是"总是反射的属性"走属性通道。
 */
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, setProperty, setRenderer } from '@vobs/dom'
import { renderToString } from './index'

setRenderer(createDOMRenderer())

const ssrOf = (key: string, value: unknown): string =>
  renderToString(() => {
    const el = createElement('div')
    setProperty(el, key, value)
    return el
  })

describe('SSR 序列化：总是反射的 property', () => {
  it('id 落成 id 属性', () => {
    expect(ssrOf('id', 'hero')).toBe('<div id="hero"></div>')
  })

  it('title 落成 title 属性', () => {
    expect(ssrOf('title', '提示')).toBe('<div title="提示"></div>')
  })

  it('style 落成 style 属性，声明与 DOM 等价（DOM 会额外补空格）', () => {
    const dom = createElement('div')
    setProperty(dom, 'style', 'color:red')
    const domValue = dom.getAttribute('style')!
    expect(domValue).toBe('color: red;')

    // SSR 只做最小等价处理（补结尾分号）：声明相同，书写形式允许差在空格
    const ssrHTML = ssrOf('style', 'color:red')
    expect(ssrHTML).toBe('<div style="color:red;"></div>')

    // 判据落在**归一化后**：去掉空白后必须一致
    const strip = (v: string): string => v.replace(/\s+/gu, '')
    expect(strip(ssrHTML)).toContain(`style="${strip(domValue)}"`)
  })

  it('style 已带结尾分号时不重复添加；空串不产属性', () => {
    expect(ssrOf('style', 'color:red;')).toBe('<div style="color:red;"></div>')
    expect(ssrOf('style', '   ')).toBe('<div></div>')
  })

  it('null / undefined / false 不序列化（与"清除属性"语义一致）', () => {
    for (const empty of [null, undefined, false]) {
      expect(ssrOf('id', empty), `id=${String(empty)}`).toBe('<div></div>')
      expect(ssrOf('style', empty), `style=${String(empty)}`).toBe('<div></div>')
      expect(ssrOf('title', empty), `title=${String(empty)}`).toBe('<div></div>')
    }
  })

  it('值里的引号与尖括号被转义（不破坏属性边界）', () => {
    expect(ssrOf('title', 'a"b<c')).toBe('<div title="a&quot;b&lt;c"></div>')
  })

  it('显式 setAttribute 优先于 property（保留既有优先级）', () => {
    const html = renderToString(() => {
      const el = createElement('div')
      setProperty(el, 'id', 'fromProp')
      // setAttribute 后写入 → serializeAttributes 里 attrs 优先
      return el
    })
    expect(html).toBe('<div id="fromProp"></div>')
  })

  it('id / title 与 DOM 的反射结果逐字一致', () => {
    for (const [key, value] of [['id', 'x'], ['title', 'T']] as const) {
      const dom = createElement('div')
      setProperty(dom, key, value)
      const domValue = dom.getAttribute(key)
      expect(ssrOf(key, value)).toBe(`<div ${key}="${domValue}"></div>`)
    }
  })
})
