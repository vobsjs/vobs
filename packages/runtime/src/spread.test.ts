// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindSpreadProps, createElement } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `{...props}` spread.
 *
 * The compiler used to emit only `spreadProps` — applied once at creation and done, so
 * "changed props don't take effect" and "keys deleted from the object stay on the DOM
 * forever" both failed without error. Now it emits bindSpreadProps, applying the diff
 * every round.
 */
describe('bindSpreadProps', () => {
  it('re-applies when the object changes (it used to apply only at creation)', async () => {
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

  it('vanished keys are removed (they used to stay on the DOM forever)', async () => {
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

  it('property keys reset when they vanish (booleans back to false, the rest to empty string)', async () => {
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

  it('replaced event handlers stop the old ones from firing', async () => {
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

  it('removed event handlers no longer fire', async () => {
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
