// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindSpreadProps, createElement } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `bindSpreadProps`'s incremental diff baseline is "the previous round's object reference"
 * (`previous = next` in ops.ts).
 *
 * Storing `previous` as the **same reference** as `next` makes the next round's
 * `Object.is(previous[key], value)` read the same values → **always equal → the entire
 * diff short-circuits**, and the removal loop is skipped wholesale by `key in next`.
 *
 * And the shape the compiler emits for `<div {...props}>` is precisely
 * **identity-stable + getter** (`bindSpreadProps(_el0, () => props)`, props read
 * reactively through getters), so this isn't a hypothetical usage: with real compiled
 * output, changing props meant attributes/events/class **never landed on the DOM at all**.
 *
 * All 5 cases in `spread.test.ts` use "assign a fresh object every round"
 * (`props.value = {...}`), which happens to sidestep this shape — 101 runtime cases all
 * green, yet nobody asked "what does this path look like in real compiled output".
 */
describe('bindSpreadProps under the identity-stable + getter shape (the compiler\'s real output shape)', () => {
  it('same object reference with a changing getter value: the attribute must update', async () => {
    const title = state('a')
    // Identity-stable: the same object every time, values read through the getter
    const props = { get title() { return title.value } }
    const el = createElement('div')
    bindSpreadProps(el, () => props)
    await flush()

    // First application
    expect(el.getAttribute('title')).toBe('a')

    title.value = 'b'
    // The effect is scheduled (not synchronous), so flush a round here
    await flush()
    expect(el.getAttribute('title')).toBe('b')
  })

  it('handler identity change must rebind the event (and the new handler takes effect)', async () => {
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
    // Before the fix: the diff short-circuited as always-equal → still first, and second was never attached
    expect(calls).toEqual(['first', 'second'])
  })

  it('keys deleted from the object get their attributes removed (null values don\'t remove — that\'s the pinned contract)', async () => {
    const present = state(true)
    /*
     * Express removal as "key present or not", not "value becomes null":
     * `props.test.ts` pins null/undefined = "no value provided, keep the status quo" as a
     * contract, so this path's clearing semantics are **deleting the key** (the removal
     * loop below), not setting the value to null.
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

  it('boolean property value changes must be followed when identity-stable', async () => {
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

  it('the value property must also be followed when identity-stable (controlled input)', async () => {
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
