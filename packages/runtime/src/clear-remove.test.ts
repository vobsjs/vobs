// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { onDispose, state } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import {
  bindText,
  clear,
  createComponent,
  createElement,
  createText,
  insertBefore,
  removeChild,
  type VobsNode
} from './index'

setRenderer(createDOMRenderer())

function Item(props: { readonly label: () => string }): VobsNode {
  const el = createElement('div')
  const text = createText('')
  insertBefore(el, text, null)
  bindText(text, () => props.label())
  return el
}

/** 组件清理时抛错的组件（用于验证顺序：DOM 先摘、Owner 后释放）。 */
function Boom(): VobsNode {
  const el = createElement('div')
  onDispose(() => { throw new Error('cleanup boom') })
  return el
}

/*
 * `removeChild` 原来是「先释放 Owner 再摘 DOM」：cleanup 抛错就永远走不到摘除，
 * DOM 里留着旧节点、它的 effect 却已经没了 —— 屏幕上两棵树且没有任何提示。
 */
describe('removeChild 的顺序', () => {
  it('cleanup 抛错也仍然把节点从 DOM 摘掉', () => {
    const parent = document.createElement('div')
    const child = createComponent(Boom, {})
    insertBefore(parent as unknown as Node, child, null)
    expect((parent as unknown as Node).contains(child as unknown as Node)).toBe(true)

    expect(() => removeChild(parent as unknown as Node, child)).toThrow('cleanup boom')
    // 关键：DOM 已经一致了
    expect((parent as unknown as Node).contains(child as unknown as Node)).toBe(false)
  })
})

/*
 * `clear` 原来只调渲染器（`textContent = ''`）——被清掉子树的 Owner 一个都不释放：
 * 组件里的 effect 继续订阅信号（幽灵更新）、监听不解绑、onDispose 不跑。
 */
describe('clear 释放 Owner', () => {
  it('组件输出节点上的 Owner 被释放，清空后不再幽灵更新', async () => {
    const label = state('a')
    const host = document.createElement('div')
    for (let i = 0; i < 3; i++) {
      insertBefore(host, createComponent(Item, { label: () => label.value }), null)
    }
    const flush = async () => { await Promise.resolve(); await Promise.resolve() }

    await flush()
    expect(host.textContent).toBe('aaa')

    clear(host)
    expect(host.textContent).toBe('')

    // 幽灵更新：如果 Owner 没释放，这里会重新写回文本
    label.value = 'b'
    await flush()
    expect(host.textContent).toBe('')
  })

  it('清理抛错也不影响容器被清空，错误照旧抛出', () => {
    const host = document.createElement('div')
    // 用组件（输出节点会登记 Owner）—— 手工 createOwner 不登记节点，walk 找不到它，
    // 这正是 clear 的覆盖边界：组件边界内的清理是完整的，组件外自己建的 effect 归它的 Owner 管。
    insertBefore(host as unknown as Node, createComponent(Boom, {}), null)
    insertBefore(host as unknown as Node, createComponent(Item, { label: () => 'x' }), null)

    expect(() => clear(host as unknown as Node)).toThrow('cleanup boom')
    expect((host as unknown as Node).childNodes.length).toBe(0)
  })
})
