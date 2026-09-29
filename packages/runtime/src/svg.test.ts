// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, createElement, insertBefore } from '@vobs/vobs'

// 回归（Labelune 踩坑备忘）：createElement('svg'/'rect') 此前走 HTML namespace，
// 产物是 HTMLUnknownElement——整棵 SVG 子树静默不渲染且无报错。
// 1.7.4 起 createElement 按 SVG 标签全集分发到渲染器 createSvgElement（createElementNS）。
describe('svg namespace element creation', () => {
  it('creates SVG-namespace elements for SVG tags and HTML for the rest', () => {
    setRenderer(createDOMRenderer())
    const svg = createElement('svg')
    expect(svg).toBeInstanceOf(SVGElement)
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')

    const rect = createElement('rect')
    expect(rect).toBeInstanceOf(SVGElement)
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg')

    // 驼峰 SVG 标签（clipPath/linearGradient）同样命中
    expect(createElement('clipPath').namespaceURI).toBe('http://www.w3.org/2000/svg')

    // 与 HTML 同名集合之外的普通标签仍是 HTML namespace
    const div = createElement('div')
    expect(div).toBeInstanceOf(HTMLDivElement)
    expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
  })

  it('builds a renderable, queryable svg tree via createElement/insertBefore', () => {
    setRenderer(createDOMRenderer())
    const svg = createElement('svg')
    svg.setAttribute('viewBox', '0 0 50 30')
    const rect = createElement('rect')
    rect.setAttribute('x', '0')
    rect.setAttribute('y', '0')
    rect.setAttribute('width', '50')
    rect.setAttribute('height', '30')
    insertBefore(svg, rect, null)

    const host = document.createElement('div')
    insertBefore(host, svg, null)

    // 真实 SVG 子树：querySelector 命中、命名空间正确、属性大小写保留
    expect(host.querySelector('svg')).not.toBeNull()
    const found = host.querySelector('rect')
    expect(found).not.toBeNull()
    expect(found!.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 50 30')
  })

  it('falls back to createElement when the renderer lacks createSvgElement', () => {
    setRenderer({
      ...createDOMRenderer(),
      createSvgElement: undefined
    })
    const rect = createElement('rect')
    // 旧自定义渲染器兜底：按 HTML 创建（保持原行为，不抛错）
    expect(rect.namespaceURI).not.toBe('http://www.w3.org/2000/svg')
  })
})
