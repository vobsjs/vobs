import { describe, expect, it } from 'vitest'
import { createElement, setProperty } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/**
 * `setProperty(node, 'innerHTML', markup)` 是框架里唯一的"原始标记"逃生口
 * （icon-core 的 SVG、ui/combobox 的下拉箭头都靠它）。但它两端都不成立：
 *
 * - 服务端：`serializeAttributes` 的白名单只认 value/tabIndex/className/布尔属性，
 *   innerHTML 既不是属性也不是那个白名单里的 property → **整个 <svg> 静默消失**；
 * - 客户端水合：`Reflect.set(node, 'innerHTML', ...)` 会真的换掉子节点，
 *   新节点不在认领表里 → `assertAllNodesClaimed` 抛 `extra-node`。
 *
 * 于是「组件用 innerHTML 放原始标记」这条路在 SSR + 水合下根本走不通。
 */
describe('SSR 的 innerHTML 逃生口', () => {  const markup = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1"/></svg>'
  const render = () => {
    const span = createElement('span')
    setProperty(span, 'innerHTML', markup)
    return span
  }

  it('服务端产物保留原始标记', () => {
    expect(renderToString(render)).toBe(`<span>${markup}</span>`)
  })

  it('产物可以水合，且 innerHTML 换出来的子树不被当成多余节点', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    expect(document.body.querySelector('svg path')?.getAttribute('d')).toBe('M1')
    app.destroy()
    document.body.innerHTML = ''
  })
})
