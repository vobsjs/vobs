// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { state } from '@vobs/reactivity'
import { bindAttribute, bindProperty, setProperty, setStaticProps, spreadProps } from './index'

setRenderer(createDOMRenderer())

describe('select value sync', () => {
  it('option 子节点就绪后重放 value 赋值（微任务）', async () => {
    const select = document.createElement('select') as HTMLSelectElement
    // 模拟编译产物顺序：先设置 value，后插入 option 子节点
    setProperty(select, 'value', 'b')
    select.innerHTML = '<option value="a">A</option><option value="b">B</option>'
    // 子节点插入使 value 回落到首个 option
    expect(select.value).toBe('a')
    await Promise.resolve()
    expect(select.value).toBe('b')
  })

  it('setStaticProps 的 value 走同一重放路径', async () => {
    const select = document.createElement('select') as HTMLSelectElement
    setStaticProps(select, { value: 'x' })
    select.innerHTML = '<option value="x">X</option>'
    expect(select.value).toBe('x')
    await Promise.resolve()
    expect(select.value).toBe('x')
  })

  it('同一微任务内多次赋值以最后一次为准', async () => {
    const select = document.createElement('select') as HTMLSelectElement
    setProperty(select, 'value', 'a')
    setProperty(select, 'value', 'c')
    select.innerHTML = '<option value="a">A</option><option value="c">C</option>'
    await Promise.resolve()
    expect(select.value).toBe('c')
  })
})

describe('static and spread prop application', () => {
  it('spreadProps applies false for property keys to clear them', () => {
    const node = document.createElement('input') as HTMLInputElement
    node.disabled = true
    spreadProps(node, { disabled: false })
    expect(node.disabled).toBe(false)

    node.readOnly = true
    spreadProps(node, { readOnly: false })
    expect(node.readOnly).toBe(false)
  })

  it('spreadProps applies true for property keys', () => {
    const node = document.createElement('input') as HTMLInputElement
    spreadProps(node, { disabled: true })
    expect(node.disabled).toBe(true)
  })

  it('spreadProps skips false for attribute keys', () => {
    const node = document.createElement('div') as HTMLDivElement
    spreadProps(node, { title: false, class: false, draggable: false })
    expect(node.hasAttribute('title')).toBe(false)
    expect(node.hasAttribute('class')).toBe(false)
  })

  it('spreadProps skips null and undefined for both key kinds', () => {
    const node = document.createElement('input') as HTMLInputElement
    node.disabled = true
    spreadProps(node, { disabled: null, title: undefined })
    // null/undefined 表示“不提供值”，保持现状语义
    expect(node.disabled).toBe(true)
    expect(node.hasAttribute('title')).toBe(false)
  })

  it('setStaticProps applies false for property keys', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { disabled: false, checked: false } as Record<string, unknown>)
    expect(node.disabled).toBe(false)
    expect(node.checked).toBe(false)
  })

  it('setStaticProps skips false for attribute keys', () => {
    const node = document.createElement('div') as HTMLDivElement
    setStaticProps(node, { title: false } as Record<string, unknown>)
    expect(node.hasAttribute('title')).toBe(false)
  })
})

/*
 * null / undefined 不该被 String() 成字面量写进 DOM。
 *
 * bindText 早就把 null/undefined 当 ''，静态路径 setStaticProps 也跳过它们，
 * 只有响应式的 bindAttribute / bindProperty 漏了 —— 于是 placeholder={undefined}
 * 会写进 "undefined"，input.value = undefined 也会被 DOM 强转成字符串。
 */
describe('绑定 null / undefined', () => {
  // vobs 的更新是微任务批处理：写完要让它跑一轮，断言才成立
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }

  it('bindAttribute 不把 undefined 写成字面量', async () => {
    const input = document.createElement('input')
    const source = state<unknown>('提示')
    bindAttribute(input, 'placeholder', source)
    await flush()
    expect(input.getAttribute('placeholder')).toBe('提示')

    source.value = undefined
    await flush()
    expect(input.getAttribute('placeholder')).not.toBe('undefined')

    source.value = 'ok'
    await flush()
    expect(input.getAttribute('placeholder')).toBe('ok')
  })

  it('bindProperty 不把 undefined 写成字面量，但 false 必须透传', async () => {
    const input = document.createElement('input')
    const source = state<unknown>('a')
    bindProperty(input, 'value', source)
    await flush()
    expect(input.value).toBe('a')

    source.value = undefined
    await flush()
    expect(input.value).not.toBe('undefined')

    const disabled = state<unknown>(true)
    bindProperty(input, 'disabled', disabled)
    await flush()
    expect(input.disabled).toBe(true)
    disabled.value = false
    await flush()
    expect(input.disabled).toBe(false)
  })

  it('null 同样被挡住', async () => {
    const div = document.createElement('div')
    const source = state<unknown>('x')
    bindAttribute(div, 'title', source)
    await flush()
    expect(div.getAttribute('title')).toBe('x')
    source.value = null
    await flush()
    expect(div.getAttribute('title')).not.toBe('null')
  })
})