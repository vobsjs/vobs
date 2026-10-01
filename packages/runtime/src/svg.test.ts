// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, getRenderer, createElement, createSvgElement, insertBefore } from '@vobs/vobs'
import { SVG_NAMESPACE } from './svg'

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

    // 还原：全局渲染器是共享状态，换了不还原会让后面的用例在 stub 上跑（曾经真的踩到）
    setRenderer(createDOMRenderer())
  })
})

/*
 * SVG 命名空间继承：a / title / style / script 与 HTML 同名，光看名字会建出 HTML 元素。
 * 编译器在 <svg> 子树里显式改走 createSvgElement（见 compiler 的同名测试）。
 */
describe('createSvgElement 强制 SVG 命名空间', () => {
  it('与 HTML 同名的标签也建在 SVG 命名空间里', () => {
    const r = getRenderer()
    console.log('DEBUG op =', createSvgElement('a').namespaceURI)
    console.log('DEBUG renderer.createSvgElement =', typeof r.createSvgElement, '→', r.createSvgElement?.('a').namespaceURI)
    console.log('DEBUG createElement(svg) =', createElement('svg').namespaceURI)
    const anchor = createSvgElement('a')
    expect(anchor.namespaceURI).toBe(SVG_NAMESPACE)
    expect(anchor.constructor.name).not.toBe('HTMLAnchorElement')

    // 对照：同样名字走 createElement 就是 HTML 元素
    expect(createElement('a').namespaceURI).not.toBe(SVG_NAMESPACE)
  })

  it('title 同样', () => {
    expect(createSvgElement('title').namespaceURI).toBe(SVG_NAMESPACE)
  })
})
