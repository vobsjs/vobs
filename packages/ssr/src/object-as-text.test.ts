// @vitest-environment jsdom
/*
 * SSG/SSR 阶段：**把对象当文本**必须报错，不能静默产出 `[object Object]`。
 *
 * 为什么：HTML 里出现 `[object Object]` 是静默失败的典型 —— 页面照常出来，
 * 只有那一块文字是错的；等上线肉眼发现再回头翻是哪一层传错。
 * 外部踩坑文档里这条**发生过两次**（官网 2026-09-18 与 2026-10-01）。
 *
 * 判据是「文本内容恰好等于 `[object Object]`」：走到序列化时值早已被字符串化、
 * 类型信息不在了，而这串字符作为作者本意的概率极低、作为"对象被字符串化"的痕迹
 * 是唯一常见来源 —— 宁可报错也不静默。
 */
import { describe, expect, it } from 'vitest'
import { createElement, createText, insertBefore, setTextContent } from '@vobs/dom'
import { renderToString } from './index'

describe('SSR 把对象当文本时直接报错', () => {
  it('文本通道收到对象字符串化的结果 → 抛出并说明原因', () => {
    const tree = () => {
      const div = createElement('div')
      const text = createText('')
      insertBefore(div, text, null)
      // 模拟"数据里混进对象后被当文本插值"
      setTextContent(text, String({ some: 'node' }))
      return div
    }
    expect(() => renderToString(tree)).toThrowError(/\[object Object\]/u)
    expect(() => renderToString(tree)).toThrowError(/对象/u)
  })

  it('正常字符串不受影响', () => {
    const tree = () => {
      const div = createElement('div')
      insertBefore(div, createText('普通文本'), null)
      return div
    }
    expect(renderToString(tree)).toBe('<div>普通文本</div>')
  })

  it('含 `<` `&` 的文本仍然正确转义（没有把判据做宽）', () => {
    const tree = () => {
      const div = createElement('div')
      insertBefore(div, createText('a & <b>'), null)
      return div
    }
    expect(renderToString(tree)).toBe('<div>a &amp; &lt;b&gt;</div>')
  })

  it('空文本仍然是空注释占位（水合契约不变）', () => {
    const tree = () => {
      const div = createElement('div')
      insertBefore(div, createText(''), null)
      return div
    }
    expect(renderToString(tree)).toBe('<div><!----></div>')
  })

  it('数字与汉字混合等常见内容都放行', () => {
    for (const value of ['0', '123', '-1.5', '你好', 'a b c', '100%', 'a[object]b']) {
      const tree = () => {
        const div = createElement('div')
        insertBefore(div, createText(value), null)
        return div
      }
      expect(() => renderToString(tree), `不该对 ${JSON.stringify(value)} 报错`).not.toThrow()
    }
  })
})
