// @vitest-environment jsdom
/*
 * `removeEventListener(node, event, handler)` **必须比 handler 身份**。
 *
 * 这是 DOM `removeEventListener` 的既定语义：只有 `(type, listener, capture)` 三者都一致
 * 才摘除；用另一个 listener 调用是 **no-op**。
 *
 * 修复前：实现忽略传入的 `handler` —— 只要 `(node,event)` 上有绑定就一律摘掉并删除绑定记录。
 * 于是"取消自己那次"的调用把**当前生效的别人的**监听弄没了。
 * 实测形态：`addEventListener(el,'click',A)` 之后 `removeEventListener(el,'click',B)`
 * 会把 A 摘掉，A 从此再也收不到事件。
 */
import { describe, expect, it, vi } from 'vitest'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import { addEventListener, removeEventListener } from './ops'

setRenderer(createDOMRenderer())

describe('removeEventListener 按 handler 身份摘除', () => {
  it('传另一个 handler 是 no-op，当前绑定仍然生效', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', b)   // 修复前：把 a 摘掉了

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a, '用别的 handler 调 remove 把当前绑定误摘了').toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('传同一个 handler 才真的摘除', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', a)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a).not.toHaveBeenCalled()
  })

  it('误摘失败之后，正确的摘除仍然有效（绑定记录没被破坏）', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', b)   // no-op
    removeEventListener(el, 'click', a)   // 真正摘掉
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a).not.toHaveBeenCalled()
  })

  it('重绑之后按新 handler 摘除（绑定记录跟着走）', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)
    addEventListener(el, 'click', b)            // 重绑替换

    removeEventListener(el, 'click', a)  // 旧 handler：已不是当前绑定 → no-op
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()

    removeEventListener(el, 'click', b)  // 当前绑定 → 摘掉
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('没有绑定记录时，按传入的 handler 兜底摘一次（渲染器直连仍可用）', () => {
    const el = document.createElement('button')
    const direct = vi.fn()
    const renderer = createDOMRenderer()
    renderer.addEventListener(el, 'click', direct)   // 绕过 bindEvent 直接绑

    removeEventListener(el, 'click', direct)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(direct).not.toHaveBeenCalled()
  })

  it('多个事件类型互不干扰', () => {
    const el = document.createElement('button')
    const onClick = vi.fn()
    const onFocus = vi.fn()
    addEventListener(el, 'click', onClick)
    addEventListener(el, 'focus', onFocus)

    removeEventListener(el, 'click', onClick)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focus'))
    expect(onClick).not.toHaveBeenCalled()
    expect(onFocus).toHaveBeenCalledTimes(1)
  })
})
