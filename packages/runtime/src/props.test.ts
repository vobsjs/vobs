// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { setStaticProps, spreadProps } from './index'

setRenderer(createDOMRenderer())

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
