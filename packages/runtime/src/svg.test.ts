// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, getRenderer, createElement, createSvgElement, insertBefore } from '@vobs/vobs'
import { SVG_NAMESPACE } from './svg'

// Regression (Labelune postmortem): createElement('svg'/'rect') used to go through the
// HTML namespace, producing HTMLUnknownElement — the whole SVG subtree silently failed to
// render, with no error.
// Since 1.7.4, createElement dispatches SVG tags from the full set to the renderer's
// createSvgElement (createElementNS).
describe('svg namespace element creation', () => {
  it('creates SVG-namespace elements for SVG tags and HTML for the rest', () => {
    setRenderer(createDOMRenderer())
    const svg = createElement('svg')
    expect(svg).toBeInstanceOf(SVGElement)
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')

    const rect = createElement('rect')
    expect(rect).toBeInstanceOf(SVGElement)
    expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg')

    // camelCase SVG tags (clipPath/linearGradient) hit too
    expect(createElement('clipPath').namespaceURI).toBe('http://www.w3.org/2000/svg')

    // Ordinary tags outside the HTML-homonym set stay in the HTML namespace
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

    // A real SVG subtree: querySelector hits, namespace correct, attribute casing preserved
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
    // Old custom renderer fallback: created as HTML (keeps the original behavior, no throw)
    expect(rect.namespaceURI).not.toBe('http://www.w3.org/2000/svg')

    // Restore: the global renderer is shared state; not restoring would run later cases
    // on the stub (that actually happened once)
    setRenderer(createDOMRenderer())
  })
})

/*
 * SVG namespace inheritance: a / title / style / script are HTML-homonyms; by name alone
 * they'd be built as HTML elements. The compiler explicitly switches to createSvgElement
 * inside `<svg>` subtrees (see the compiler's same-named test).
 */
describe('createSvgElement forces the SVG namespace', () => {
  it('HTML-homonym tags are also built in the SVG namespace', () => {
    const r = getRenderer()
    console.log('DEBUG op =', createSvgElement('a').namespaceURI)
    console.log('DEBUG renderer.createSvgElement =', typeof r.createSvgElement, '→', r.createSvgElement?.('a').namespaceURI)
    console.log('DEBUG createElement(svg) =', createElement('svg').namespaceURI)
    const anchor = createSvgElement('a')
    expect(anchor.namespaceURI).toBe(SVG_NAMESPACE)
    expect(anchor.constructor.name).not.toBe('HTMLAnchorElement')

    // Control: the same name through createElement is an HTML element
    expect(createElement('a').namespaceURI).not.toBe(SVG_NAMESPACE)
  })

  it('title likewise', () => {
    expect(createSvgElement('title').namespaceURI).toBe(SVG_NAMESPACE)
  })
})
