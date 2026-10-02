// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindSpreadProps, createElement } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `bindSpreadProps` 的增量 diff 基准是"上一轮的对象引用"（ops.ts 里 `previous = next`）。
 *
 * 那把 `previous` 存成 `next` 的**同一引用**时，下一轮的
 * `Object.is(previous[key], value)` 读的是同一份值 → **恒等 → 整个 diff 短路**，
 * 移除循环也因 `key in next` 全跳过。
 *
 * 而编译器为 `<div {...props}>` 发射的正是**身份稳定 + getter** 的形状
 * （`bindSpreadProps(_el0, () => props)`，props 的读取经 getter 反应式求值），
 * 所以这不是假想用法：真实产物下改了 props，属性/事件/class **完全不上 DOM**。
 *
 * `spread.test.ts` 的 5 条用例全部走"每轮赋一个新对象"（`props.value = {...}`），
 * 恰好绕开了这个形状 —— 101 条 runtime 用例全绿，却没人问"这条路在真实产物里长什么样"。
 */
describe('bindSpreadProps 在身份稳定 + getter 的形状下（编译器真实产物形状）', () => {
  it('同一对象引用、getter 值变化时，attribute 必须更新', async () => {
    const title = state('a')
    // 身份稳定：每次都是同一个对象，值经 getter 读取
    const props = { get title() { return title.value } }
    const el = createElement('div')
    bindSpreadProps(el, () => props)
    await flush()

    // 首次应用
    expect(el.getAttribute('title')).toBe('a')

    title.value = 'b'
    // effect 是调度执行（不是同步），所以这里要 flush 一轮
    await flush()
    expect(el.getAttribute('title')).toBe('b')
  })

  it('handler 身份变化时事件必须重绑（且新 handler 生效）', async () => {
    const calls: string[] = []
    const first = () => calls.push('first')
    const second = () => calls.push('second')
    const handler = state(first)
    const props = { get onClick() { return handler.value } }
    const el = createElement('button')
    bindSpreadProps(el, () => props)
    await flush()

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual(['first'])

    handler.value = second
    await flush()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // 修复前：diff 恒等短路 → 仍是 first，且 second 从未被挂上
    expect(calls).toEqual(['first', 'second'])
  })

  it('键从对象里删掉时 attribute 被移除（null 值不移除，那是已钉的契约）', async () => {
    const present = state(true)
    /*
     * 用"键在不在"表达移除，而不是"值变 null"：
     * `props.test.ts` 把 null/undefined = "不提供值、保持现状"钉成了契约，
     * 所以这条路径的清除语义是**删键**（下面的移除循环），不是把值设成 null。
     */
    const props = new Proxy({} as Record<string, unknown>, {
      ownKeys: () => (present.value ? ['data-extra'] : []),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: '1' }),
      get: (_t, key) => (key === 'data-extra' ? '1' : undefined)
    })
    const el = createElement('div')
    bindSpreadProps(el, () => props)
    await flush()
    expect(el.getAttribute('data-extra')).toBe('1')

    present.value = false
    await flush()
    expect(el.hasAttribute('data-extra')).toBe(false)
  })

  it('身份稳定时布尔 property 的值变化必须跟进', async () => {
    const flag = state(true)
    const props = { get disabled() { return flag.value } }
    const el = createElement('input') as HTMLInputElement
    bindSpreadProps(el as unknown as Element, () => props)
    await flush()
    expect(el.disabled).toBe(true)

    flag.value = false
    await flush()
    expect(el.disabled).toBe(false)
  })

  it('身份稳定时 value property 也必须跟进（受控输入）', async () => {
    const text = state('v1')
    const props = { get value() { return text.value } }
    const el = createElement('input') as HTMLInputElement
    bindSpreadProps(el as unknown as Element, () => props)
    await flush()
    expect(el.value).toBe('v1')

    text.value = 'v2'
    await flush()
    expect(el.value).toBe('v2')
  })
})
