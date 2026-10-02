// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, setAttribute } from '@vobs/dom'
import { renderToString } from './index'
import { isSafeAttributeName } from './renderer'

/*
 * 属性名不能"转义"，只能拒绝 —— 否则是真实的 XSS。
 *
 * ssr 原来把 key 直接拼进标签（renderer.ts 的 ` ${key}="…"`、prerender.ts 的 serializeAttrs）。
 * HTML 里**属性名没有实体可用**，所以只要名字里带 `"` 就能提前闭合属性、注入新属性：
 * 深读报告实测把 key 设成 `a" onmouseover="alert(1)//`，产物经真实解析器会得到**活的 onmouseover**。
 * 现在两处都按 HTML 名字产生式过滤（见 isSafeAttributeName）。
 *
 * 需要一个真实解析器来证明"注入没生效"，所以这里用 jsdom 解析产物再检查属性。
 */
const INJECTION = 'a" onmouseover="alert(1)//'

describe('SSR 属性名注入', () => {
  it('renderToString 不会把恶意属性名塞进产物', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setAttribute(div, 'data-ok', 'yes')
      setAttribute(div, INJECTION, 'x')
      return div
    })
    expect(html).toContain('data-ok="yes"')          // 正常属性不受影响
    expect(html).not.toContain('onmouseover')        // 注入没有进入产物

    // 用真实解析器复核：解析出来的元素上不该有 onmouseover
    const host = document.createElement('div')
    host.innerHTML = html
    expect(host.querySelector('[onmouseover]')).toBeNull()
    expect(host.firstElementChild?.getAttribute('data-ok')).toBe('yes')
  })

  it('isSafeAttributeName 按 HTML 名字产生式判定', () => {
    for (const ok of ['data-x', 'aria-label', 'class', 'x', 'foo:bar', '@click']) {
      expect(isSafeAttributeName(ok), `${ok} 应合法`).toBe(true)
    }
    for (const bad of ['', 'a"b', "a'b", 'a b', 'a/b', 'a=b', 'a<b', 'a>b', 'a\u0000b', 'a\nb']) {
      expect(isSafeAttributeName(bad), `${bad} 应被拒`).toBe(false)
    }
  })
})
