// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindSpreadProps, createElement } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `{...props}` 展开。
 *
 * 编译器原来只发射 `spreadProps` —— 创建时应用一次就完了，于是
 * 「改了 props 不生效」和「对象里删掉的键永远留在 DOM 上」两个问题都不报错。
 * 现在发射 bindSpreadProps，每轮增量应用。
 */
describe('bindSpreadProps', () => {
  it('对象变了会重新应用（原来只在创建时应用一次）', async () => {
    const props = state<Record<string, unknown>>({ title: 'a', id: 'x' })
    const el = createElement('div')
    bindSpreadProps(el, () => props.value)
    await flush()
    expect(el.getAttribute('title')).toBe('a')
    expect(el.getAttribute('id')).toBe('x')

    props.value = { title: 'b', id: 'x' }
    await flush()
    expect(el.getAttribute('title')).toBe('b')
  })

  it('消失的键会被移除（原来会永远留在 DOM 上）', async () => {
    const props = state<Record<string, unknown>>({ title: 'a', 'data-extra': '1' })
    const el = createElement('div')
    bindSpreadProps(el, () => props.value)
    await flush()
    expect(el.hasAttribute('data-extra')).toBe(true)

    props.value = { title: 'a' }
    await flush()
    expect(el.hasAttribute('data-extra')).toBe(false)
    expect(el.getAttribute('title')).toBe('a')
  })

  it('property 键消失时复位（布尔回 false，其余回空串）', async () => {
    const props = state<Record<string, unknown>>({ disabled: true, value: 'v' })
    const el = createElement('input') as HTMLInputElement
    bindSpreadProps(el as unknown as Element, () => props.value)
    await flush()
    expect(el.disabled).toBe(true)
    expect(el.value).toBe('v')

    props.value = {}
    await flush()
    expect(el.disabled).toBe(false)
    expect(el.value).toBe('')
  })

  it('事件处理器被替换后旧的不再生效', async () => {
    const calls: string[] = []
    const props = state<Record<string, unknown>>({ onClick: () => calls.push('first') })
    const el = createElement('button')
    bindSpreadProps(el, () => props.value)
    await flush()

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual(['first'])

    props.value = { onClick: () => calls.push('second') }
    await flush()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual(['first', 'second'])
  })

  it('事件处理器被移除后不再触发', async () => {
    const calls: string[] = []
    const props = state<Record<string, unknown>>({ onClick: () => calls.push('hit') })
    const el = createElement('button')
    bindSpreadProps(el, () => props.value)
    await flush()

    props.value = {}
    await flush()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual([])
  })
})
