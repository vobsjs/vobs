// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { state } from '@vobs/reactivity'
import { bindAttribute, bindProperty, setProperty, setStaticProps, spreadProps } from './index'

setRenderer(createDOMRenderer())

describe('select value sync', () => {
  it('replays the value assignment once the option children are ready (microtask)', async () => {
    const select = document.createElement('select') as HTMLSelectElement
    // Simulate compiled-output order: set value first, insert option children after
    setProperty(select, 'value', 'b')
    select.innerHTML = '<option value="a">A</option><option value="b">B</option>'
    // The children insertion makes value fall back to the first option
    expect(select.value).toBe('a')
    await Promise.resolve()
    expect(select.value).toBe('b')
  })

  it('setStaticProps\'s value goes through the same replay path', async () => {
    const select = document.createElement('select') as HTMLSelectElement
    setStaticProps(select, { value: 'x' })
    select.innerHTML = '<option value="x">X</option>'
    expect(select.value).toBe('x')
    await Promise.resolve()
    expect(select.value).toBe('x')
  })

  it('multiple assignments within the same microtask: the last one wins', async () => {
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
    // null/undefined mean "no value provided": keep the status quo
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
 * null / undefined must not be String()'d into literals written to the DOM.
 *
 * bindText has long treated null/undefined as ''; the static path setStaticProps skips
 * them too; only the reactive bindAttribute / bindProperty missed it — so
 * placeholder={undefined} would write "undefined", and input.value = undefined would be
 * coerced into a string by the DOM.
 */
describe('binding null / undefined', () => {
  // vobs updates are microtask-batched: after writing, let a round run before asserting
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }

  it('bindAttribute does not write undefined as a literal', async () => {
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

  it('bindProperty does not write undefined as a literal, but false must pass through', async () => {
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

  it('null is blocked the same way', async () => {
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