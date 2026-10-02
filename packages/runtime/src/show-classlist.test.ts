// @vitest-environment jsdom
/*
 * `Show` + `classList` —— 外部踩坑文档 C 条的对策，从"人肉纪律"变成一行。
 *
 * C 条：条件分支里的输入控件丢焦点 —— `insertDynamic` 按引用比较（`next === current`），
 * 条件表达式一变化就**重建子树**，于是每敲一个字符焦点就丢、滚动位置与内部状态全丢。
 *
 * 判据用**节点身份 + 焦点**（不是"看起来对不对"）：
 * - 条件反复变化后，输入元素**还是同一个对象**
 * - `document.activeElement` 始终是它（焦点没丢）
 * - 输入框里的值没被重置
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { applyClassList, bindAttribute, setStaticProps, Show } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('Show：保留挂载，条件变化不重建子树', () => {
  function mountShow(when: () => boolean, extra: Record<string, unknown> = {}) {
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Show, {
        get when() { return when() },
        children: () => {
          const input = createElement('input') as HTMLInputElement
          return input
        },
        ...extra
      } as never)
    })
    app.mount(host)
    const input = (): HTMLInputElement | null => host.querySelector('input')
    return { host, app, input, cleanup: () => { app.destroy(); host.remove() } }
  }

  it('条件切换后输入元素**仍是同一个对象**（没被重建）', () => {
    const open = state(true)
    const view = mountShow(() => open.value)
    const before = view.input()
    expect(before).not.toBeNull()

    open.value = false
    settle()
    open.value = true
    settle()
    open.value = false
    settle()
    expect(view.input(), 'Show 重建了子树（这正是 C 条那个 bug）').toBe(before)
    view.cleanup()
  })

  it('条件切换不丢焦点、不重置输入值', () => {
    const open = state(true)
    const view = mountShow(() => open.value)
    const input = view.input()!
    input.focus()
    input.value = '用户输入的内容'
    expect(document.activeElement).toBe(input)

    open.value = false
    settle()
    open.value = true
    settle()

    expect(document.activeElement, '条件变化把焦点弄丢了').toBe(input)
    expect(input.value, '条件变化重置了用户输入').toBe('用户输入的内容')
    view.cleanup()
  })

  it('隐藏时挂 hidden + inert（移出焦点顺序与无障碍树）', () => {
    const open = state(true)
    const view = mountShow(() => open.value)
    const input = view.input()!

    expect(input.hidden).toBe(false)
    expect(input.hasAttribute('inert')).toBe(false)

    open.value = false
    settle()
    expect(input.hidden).toBe(true)
    expect(input.hasAttribute('inert')).toBe(true)

    open.value = true
    settle()
    expect(input.hidden).toBe(false)
    expect(input.hasAttribute('inert'), '重新显示后 inert 没被移除').toBe(false)
    view.cleanup()
  })

  it('hiddenClass 按需增删，且不影响作者自己的类名', () => {
    const open = state(true)
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Show, {
        get when() { return open.value },
        hiddenClass: 'is-hidden',
        children: () => {
          const el = createElement('div')
          el.setAttribute('class', 'panel custom')
          return el
        }
      } as never)
    })
    app.mount(host)
    const el = host.querySelector('div')!
    expect(el.getAttribute('class')).toBe('panel custom')

    open.value = false
    settle()
    expect(el.getAttribute('class')).toBe('panel custom is-hidden')

    open.value = true
    settle()
    expect(el.getAttribute('class'), '作者的类名被抹掉了').toBe('panel custom')
    app.destroy(); host.remove()
  })

  it('children 不是单个元素 → 抛出并说明该怎么改（不静默退化）', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)
    expect(() => {
      createVobs({
        render: () => createComponent(Show, {
          when: true,
          children: 'plain text' as unknown as VobsNode
        } as never)
      }).mount(host)
    }).toThrowError(/单个元素/u)
    host.remove()
  })

  it('children 为空 → 抛出', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)
    expect(() => {
      createVobs({ render: () => createComponent(Show, { when: true } as never) }).mount(host)
    }).toThrowError(/不能为空/u)
    host.remove()
  })
})

describe('classList：一行替代手拼类名字符串', () => {
  it('对象形式：真值加类、假值不加', () => {
    const el = createElement('div')
    applyClassList(el, { 'is-open': true, 'is-busy': false, 'is-ready': 1 })
    expect(el.getAttribute('class')).toBe('is-open is-ready')
  })

  it('数组形式与条件项', () => {
    const el = createElement('div')
    applyClassList(el, ['base', false, null, undefined, 'extra'])
    expect(el.getAttribute('class')).toBe('base extra')
  })

  it('反复切换**不会越加越多**，也不会抹掉作者的 class', () => {
    const el = createElement('div')
    el.setAttribute('class', 'panel')
    applyClassList(el, { 'is-open': true })
    expect(el.getAttribute('class')).toBe('panel is-open')
    applyClassList(el, { 'is-open': false })
    expect(el.getAttribute('class')).toBe('panel')
    applyClassList(el, { 'is-open': true })
    expect(el.getAttribute('class'), '反复切换后类名叠加了').toBe('panel is-open')
  })

  it('走真实 props 通道（setStaticProps）也生效 —— 证明接线，不只是算法', () => {
    const el = createElement('div')
    setStaticProps(el, { class: 'panel', classList: { 'is-open': true, 'is-busy': false } })
    expect(el.getAttribute('class')).toBe('panel is-open')
    // 不该写出一个浏览器不认识的 classlist 属性
    expect(el.hasAttribute('classlist')).toBe(false)
  })

  it('走编译器真实产物那条路（bindAttribute）也是响应式的', () => {
    // 实测编译产物：classList={{...}} → bindAttribute(_el0, "classList", () => ({...}))
    const open = state(true)
    const el = createElement('div')
    el.setAttribute('class', 'panel')
    bindAttribute(el, 'classList', () => ({ 'is-open': open.value, 'is-busy': !open.value }))
    settle()
    expect(el.getAttribute('class')).toBe('panel is-open')

    open.value = false
    settle()
    expect(el.getAttribute('class')).toBe('panel is-busy')

    open.value = true
    settle()
    expect(el.getAttribute('class'), '反复切换后类名叠加了').toBe('panel is-open')
  })

  it('空对象 / 空数组清掉自己贡献的类', () => {
    const el = createElement('div')
    el.setAttribute('class', 'panel')
    applyClassList(el, { 'is-open': true })
    applyClassList(el, {})
    expect(el.getAttribute('class')).toBe('panel')
  })
})
