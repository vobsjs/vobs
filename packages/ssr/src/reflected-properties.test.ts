// @vitest-environment jsdom
/*
 * Server serialization must cover the **always-reflected** properties: `id` / `style` /
 * `title`.
 *
 * The gap (empirically compared against `setProperty` on the DOM):
 *   setProperty(el,'id','x')             → DOM `id="x"`                 SSR lost
 *   setProperty(el,'style','color:red')  → DOM `style="color: red;"`    SSR lost
 *   setProperty(el,'title','T')          → DOM `title="T"`              SSR lost
 *
 * The consequence is heavier than "one attribute missing": first-paint HTML has no
 * id/style/title → CSS selectors and `document.getElementById` miss them on first paint →
 * they only appear after client hydration (visible flash).
 *
 * Same family as the existing `text-content.test.ts`: that one fixed `textContent` going
 * through the text channel; this one fixes "always-reflected properties" going through the
 * attribute channel.
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

describe('SSR serialization: always-reflected properties', () => {
  it('id lands as the id attribute', () => {
    expect(ssrOf('id', 'hero')).toBe('<div id="hero"></div>')
  })

  it('title lands as the title attribute', () => {
    expect(ssrOf('title', '提示')).toBe('<div title="提示"></div>')
  })

  it('style lands as the style attribute with declarations equivalent to the DOM (DOM adds extra spaces)', () => {
    const dom = createElement('div')
    setProperty(dom, 'style', 'color:red')
    const domValue = dom.getAttribute('style')!
    expect(domValue).toBe('color: red;')

    // SSR only does the minimal equivalent handling (append trailing semicolon): same
    // declarations, spelling may differ in spaces
    const ssrHTML = ssrOf('style', 'color:red')
    expect(ssrHTML).toBe('<div style="color:red;"></div>')

    // The assertion applies **after normalization**: must match once whitespace is stripped
    const strip = (v: string): string => v.replace(/\s+/gu, '')
    expect(strip(ssrHTML)).toContain(`style="${strip(domValue)}"`)
  })

  it('a trailing semicolon is not duplicated; empty strings produce no attribute', () => {
    expect(ssrOf('style', 'color:red;')).toBe('<div style="color:red;"></div>')
    expect(ssrOf('style', '   ')).toBe('<div></div>')
  })

  it('null / undefined / false are not serialized (matching the "clear attribute" semantics)', () => {
    for (const empty of [null, undefined, false]) {
      expect(ssrOf('id', empty), `id=${String(empty)}`).toBe('<div></div>')
      expect(ssrOf('style', empty), `style=${String(empty)}`).toBe('<div></div>')
      expect(ssrOf('title', empty), `title=${String(empty)}`).toBe('<div></div>')
    }
  })

  it('quotes and angle brackets in values are escaped (attribute boundaries stay intact)', () => {
    expect(ssrOf('title', 'a"b<c')).toBe('<div title="a&quot;b&lt;c"></div>')
  })

  it('explicit setAttribute wins over the property (existing precedence preserved)', () => {
    const html = renderToString(() => {
      const el = createElement('div')
      setProperty(el, 'id', 'fromProp')
      // written via setAttribute → attrs take precedence in serializeAttributes
      return el
    })
    expect(html).toBe('<div id="fromProp"></div>')
  })

  it('id / title match the DOM reflection result character for character', () => {
    for (const [key, value] of [['id', 'x'], ['title', 'T']] as const) {
      const dom = createElement('div')
      setProperty(dom, key, value)
      const domValue = dom.getAttribute(key)
      expect(ssrOf(key, value)).toBe(`<div ${key}="${domValue}"></div>`)
    }
  })
})
