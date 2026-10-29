// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, setAttribute } from '@vobs/dom'
import { renderToString } from './index'
import { isSafeAttributeName } from './renderer'

/*
 * Attribute names cannot be "escaped" — they can only be rejected; otherwise it is a real
 * XSS.
 *
 * ssr used to concatenate the key straight into the tag (the ` ${key}="…"` in renderer.ts
 * and serializeAttrs in prerender.ts). HTML has **no entities for attribute names**, so any
 * `"` in the name closes the attribute early and injects new ones: the deep-read report
 * empirically confirmed that key `a" onmouseover="alert(1)//` yields a **live onmouseover**
 * after the output goes through a real parser.
 * Both places now filter by the HTML name production (see isSafeAttributeName).
 *
 * A real parser is needed to prove "the injection did not take effect", so jsdom parses the
 * output and the attributes are then checked.
 */
const INJECTION = 'a" onmouseover="alert(1)//'

describe('SSR attribute name injection', () => {
  it('renderToString never lets a malicious attribute name into the output', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setAttribute(div, 'data-ok', 'yes')
      setAttribute(div, INJECTION, 'x')
      return div
    })
    expect(html).toContain('data-ok="yes"')          // the normal attribute is unaffected
    expect(html).not.toContain('onmouseover')        // the injection never enters the output

    // Re-verify with a real parser: the parsed element must not carry onmouseover
    const host = document.createElement('div')
    host.innerHTML = html
    expect(host.querySelector('[onmouseover]')).toBeNull()
    expect(host.firstElementChild?.getAttribute('data-ok')).toBe('yes')
  })

  it('isSafeAttributeName follows the HTML name production', () => {
    for (const ok of ['data-x', 'aria-label', 'class', 'x', 'foo:bar', '@click']) {
      expect(isSafeAttributeName(ok), `${ok} should be valid`).toBe(true)
    }
    for (const bad of ['', 'a"b', "a'b", 'a b', 'a/b', 'a=b', 'a<b', 'a>b', 'a\u0000b', 'a\nb']) {
      expect(isSafeAttributeName(bad), `${bad} should be rejected`).toBe(false)
    }
  })
})
