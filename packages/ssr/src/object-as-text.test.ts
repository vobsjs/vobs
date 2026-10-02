// @vitest-environment jsdom
/*
 * SSG/SSR 阶段：**把对象当文本**必须报错，不能静默产出 `[object …]`。
 *
 * 为什么：HTML 里出现 `[object Object]` / `[object HTMLDivElement]` 是静默失败的典型 ——
 * 页面照常出来，只有那一块文字是错的；等上线肉眼发现再回头翻是哪一层传错。
 * 外部踩坑文档里这条**发生过两次**（官网 2026-09-18 与 2026-10-01），
 * 其中「JSX 节点作 props / 存进数据常量」产出的是 **`[object HTMLDivElement]`** ——
 * 所以判据必须覆盖整个 `[object Xxx]` 族，不能只认 `[object Object]`。
 *
 * 判据的边界（同样重要，见文件末尾那条用例）：数组 / 函数 / 日期字符串化之后
 * 与合法文本**无法区分**，检测不到，只能靠纪律。
 */
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, createText, insertBefore, setRenderer, setTextContent } from '@vobs/dom'
import { renderToString } from './index'

// 测试体里要 `String(createElement(…))`，需要一个已装好的渲染器
setRenderer(createDOMRenderer())

/** 把一段文本放进 `<div>` 里做 SSR。 */
function treeWith(text: string) {
  return () => {
    const div = createElement('div')
    const text$ = createText('')
    insertBefore(div, text$, null)
    setTextContent(text$, text)
    return div
  }
}

describe('SSR 把对象当文本时直接报错', () => {
  it('普通对象 → 抛出并说明原因', () => {
    expect(() => renderToString(treeWith(String({ some: 'node' }))))
      .toThrowError(/\[object /u)
    expect(() => renderToString(treeWith(String({ some: 'node' }))))
      .toThrowError(/对象/u)
  })

  it('DOM 节点 → 也抓到（文档里「JSX 作 props / 存数据常量」就是这个形态）', () => {
    expect(() => renderToString(treeWith(String(createElement('span')))))
      .toThrowError(/\[object /u)
  })

  it('Map / Set 等宿主对象同样抓到', () => {
    for (const value of [new Map(), new Set(), new WeakMap()]) {
      expect(() => renderToString(treeWith(String(value))), `${String(value)} 没被抓到`)
        .toThrowError(/\[object /u)
    }
  })

  it('嵌在更长文本里的痕迹也抓到（不只整串相等）', () => {
    expect(() => renderToString(treeWith(`icon: ${String({})}`)))
      .toThrowError(/\[object /u)
  })

  it('正常字符串不受影响', () => {
    expect(renderToString(treeWith('普通文本'))).toBe('<div>普通文本</div>')
  })

  it('含 `<` `&` 的文本仍然正确转义（没有把判据做宽）', () => {
    expect(renderToString(treeWith('a & <b>'))).toBe('<div>a &amp; &lt;b&gt;</div>')
  })

  it('空文本仍然是空注释占位（水合契约不变）', () => {
    expect(renderToString(treeWith(''))).toBe('<div><!----></div>')
  })

  it('数字 / 汉字 / 百分号 / 方括号等常见内容全部放行', () => {
    for (const value of ['0', '123', '-1.5', '你好', 'a b c', '100%', 'a[object]b', 'a[object x]b', '[]', '{}']) {
      expect(() => renderToString(treeWith(value)), `不该对 ${JSON.stringify(value)} 报错`).not.toThrow()
    }
  })

  it('[object] 没有类型名时不报（避免把「恰好写成这样」的合法文本拦下来）', () => {
    for (const value of ['[object]', '[object ]', '[object 123]']) {
      expect(() => renderToString(treeWith(value)), `${JSON.stringify(value)} 被误报`).not.toThrow()
    }
  })

  it('**如实说明的边界**：数组 / 函数 / 日期字符串化后检测不到（与合法文本无法区分）', () => {
    // 这三条**不**抛错 —— 记录当前能力边界，不是为了"通过"而放宽判据
    for (const value of [[1, 2], (() => undefined), new Date(0)]) {
      expect(() => renderToString(treeWith(String(value))), `${String(value)} 竟然被抓到了（判据变宽了？）`).not.toThrow()
    }
  })
})
