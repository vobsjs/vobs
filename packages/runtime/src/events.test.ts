// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import type { Signal } from '@vobs/vobs'
import { effect, createOwner, state } from '@vobs/reactivity'
import { addEventListener, createElement, removeEventListener } from './index'

describe('event binding dedupe', () => {
  it('replaces a previous binding for the same node and event', () => {
    setRenderer(createDOMRenderer())
    const node = createElement('button')
    let first = 0
    let second = 0
    addEventListener(node, 'click', () => { first++ })
    addEventListener(node, 'click', () => { second++ })
    node.dispatchEvent(new MouseEvent('click'))
    expect(first).toBe(0)
    expect(second).toBe(1)
    removeEventListener(node, 'click', (() => undefined) as EventListener)
    node.dispatchEvent(new MouseEvent('click'))
    expect(second).toBe(1)
  })

  it('signals created inside event handlers survive owner disposal', async () => {
    // 语义锁定：addEventListener 把编译事件处理器包进 owner.run 执行（错误路由 +
    // 游离 DOM 防护）。处理器里创建的 state 是应用数据，作用域销毁后必须仍可写。
    // 回归背景：下拉菜单关闭销毁作用域，曾把菜单点击创建的元素信号连带销毁，
    // 导致"元素无法移动/缩放"（set 静默无效）。
    setRenderer(createDOMRenderer())
    const owner = createOwner()
    const node = createElement('button')

    let created: Signal<number> | null = null
    owner.run(() => {
      addEventListener(node, 'click', () => {
        if (created === null) created = state(0, 'handler.created')
        created.set(created.value + 1)
      })
    })

    node.dispatchEvent(new MouseEvent('click'))
    node.dispatchEvent(new MouseEvent('click'))
    expect(created).not.toBeNull()
    expect(created!.value).toBe(2)

    // 作用域销毁（如菜单关闭）：游离 DOM 防护继续生效——事件不再进入处理器
    owner.dispose()
    node.dispatchEvent(new MouseEvent('click'))
    expect(created!.value).toBe(2)

    // 但信号本身存活：仍可写、仍可被新效果订阅（数据寿命 = 可达性）
    const seen: number[] = []
    effect(() => { seen.push(created!.value) })
    created!.set(7)
    await Promise.resolve()
    expect(created!.value).toBe(7)
    expect(seen).toEqual([2, 7])
  })
})
