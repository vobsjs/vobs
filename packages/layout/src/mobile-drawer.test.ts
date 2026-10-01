// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 移动端抽屉不能是"没有文字的全宽抽屉"。
 *
 * 默认 `collapsed=true`，侧栏带 `is-collapsed`；而 `.vobs-kit-sidebar.is-collapsed .vobs-kit-menu__label`
 * 会 `display:none`。移动端抽屉打开时侧栏又被强制成全宽 —— 两条规则叠在一起，
 * 用户点开的是一个全宽、却没有文字的抽屉（实测类名 `is-collapsed is-mobile-open`）。
 *
 * 修法是给折叠的隐藏规则加 `:not(.is-mobile-open)`（纯 CSS，符合这个包"布局全交 CSS、
 * JS 不测量不写样式"的设计）。
 *
 * 注意：**jsdom 不应用外部样式表**，所以"视觉上真的显示出来了"无法在这里断言。
 * 下面用两条代理断言把契约钉住：①类名契约（CSS 依赖它在同一元素上）②规则守卫。
 */
const cssPath = resolve(process.cwd(), 'packages/layout/src/styles/layout.css')

describe('layout 移动端抽屉', () => {
  it('折叠态的隐藏规则把"抽屉打开"排除在外（CSS 规则守卫）', () => {
    const css = readFileSync(cssPath, 'utf8')
    // 直接钉住选择器：去掉 :not(.is-mobile-open) 就会失败
    expect(css).toContain('.vobs-kit-sidebar.is-collapsed:not(.is-mobile-open) .vobs-kit-menu__label')
    expect(css).toContain('.vobs-kit-sidebar.is-collapsed:not(.is-mobile-open) .vobs-kit-menu__badge')
    // 并且不应该再有没有守卫的旧写法（否则等于没改）
    expect(css).not.toContain('.vobs-kit-sidebar.is-collapsed .vobs-kit-menu__label')
  })
})
