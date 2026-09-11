// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { setProperty, setStaticProps, spreadProps } from './index'

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
