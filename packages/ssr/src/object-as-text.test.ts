// @vitest-environment jsdom
/*
 * SSG/SSR stage: **rendering an object as text** must throw — silently producing
 * `[object …]` is not acceptable.
 *
 * Why: `[object Object]` / `[object HTMLDivElement]` in HTML is the classic silent failure —
 * the page renders as usual with just that one piece of text wrong; it gets spotted by eye
 * after release, and then someone digs back through layers to find who passed it wrong.
 * The external pitfall log recorded this **twice** (website 2026-09-18 and 2026-10-01),
 * and "a JSX node used as props / stored in data constants" produced
 * **`[object HTMLDivElement]`** — so the predicate must cover the whole `[object Xxx]`
 * family, not just `[object Object]`.
 *
 * Boundary of the predicate (equally important, see the last case in this file): stringified
 * arrays / functions / dates are **indistinguishable** from legitimate text, undetectable —
 * only discipline helps.
 */
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, createText, insertBefore, setRenderer, setTextContent } from '@vobs/dom'
import { renderToString } from './index'

// The test bodies call `String(createElement(…))`, which needs an installed renderer
setRenderer(createDOMRenderer())

/** Wraps a piece of text in a `<div>` for SSR. */
function treeWith(text: string) {
  return () => {
    const div = createElement('div')
    const text$ = createText('')
    insertBefore(div, text$, null)
    setTextContent(text$, text)
    return div
  }
}

describe('SSR throws when an object is rendered as text', () => {
  it('plain object → throws and explains why', () => {
    expect(() => renderToString(treeWith(String({ some: 'node' }))))
      .toThrowError(/\[object /u)
    expect(() => renderToString(treeWith(String({ some: 'node' }))))
      .toThrowError(/was rendered as text/u)
  })

  it('DOM node → also caught (the documented "JSX as props / stored in data constants" shape)', () => {
    expect(() => renderToString(treeWith(String(createElement('span')))))
      .toThrowError(/\[object /u)
  })

  it('host objects like Map / Set are caught too', () => {
    for (const value of [new Map(), new Set(), new WeakMap()]) {
      expect(() => renderToString(treeWith(String(value))), `${String(value)} was not caught`)
        .toThrowError(/\[object /u)
    }
  })

  it('traces embedded in longer text are caught too (not just whole-string equality)', () => {
    expect(() => renderToString(treeWith(`icon: ${String({})}`)))
      .toThrowError(/\[object /u)
  })

  it('normal strings are unaffected', () => {
    expect(renderToString(treeWith('普通文本'))).toBe('<div>普通文本</div>')
  })

  it('text containing `<` `&` is still escaped correctly (the predicate was not widened)', () => {
    expect(renderToString(treeWith('a & <b>'))).toBe('<div>a &amp; &lt;b&gt;</div>')
  })

  it('empty text still becomes an empty comment placeholder (hydration contract unchanged)', () => {
    expect(renderToString(treeWith(''))).toBe('<div><!----></div>')
  })

  it('common content — numbers / CJK / percent signs / brackets — all pass through', () => {
    for (const value of ['0', '123', '-1.5', '你好', 'a b c', '100%', 'a[object]b', 'a[object x]b', '[]', '{}']) {
      expect(() => renderToString(treeWith(value)), `should not throw for ${JSON.stringify(value)}`).not.toThrow()
    }
  })

  it('[object] without a type name is allowed (legitimate text that happens to look like this must pass)', () => {
    for (const value of ['[object]', '[object ]', '[object 123]']) {
      expect(() => renderToString(treeWith(value)), `${JSON.stringify(value)} was falsely flagged`).not.toThrow()
    }
  })

  it('**honestly stated boundary**: stringified arrays / functions / dates are undetectable (indistinguishable from legitimate text)', () => {
    // These three do **not** throw — recording the current capability boundary, not
    // widening the predicate to "pass"
    for (const value of [[1, 2], (() => undefined), new Date(0)]) {
      expect(() => renderToString(treeWith(String(value))), `${String(value)} was unexpectedly caught (did the predicate get wider?)`).not.toThrow()
    }
  })
})
