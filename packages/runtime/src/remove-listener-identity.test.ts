// @vitest-environment jsdom
/*
 * `removeEventListener(node, event, handler)` **must compare handler identity**.
 *
 * This is the DOM `removeEventListener` established semantics: only when
 * `(type, listener, capture)` all match does it detach; calling with another listener is
 * a **no-op**.
 *
 * Before the fix: the implementation ignored the passed-in `handler` — as long as a
 * binding existed for `(node,event)` it detached and deleted the record. So a "cancel my
 * own" call killed the **currently active listener belonging to someone else**.
 * Measured form: after `addEventListener(el,'click',A)`, calling
 * `removeEventListener(el,'click',B)` detached A, and A never received events again.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import { addEventListener, removeEventListener } from './ops'

setRenderer(createDOMRenderer())

describe('removeEventListener detaches by handler identity', () => {
  it('passing another handler is a no-op; the current binding stays in effect', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', b)   // before the fix: detached a

    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a, 'calling remove with a different handler mistakenly detached the current binding').toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('passing the same handler really detaches', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', a)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a).not.toHaveBeenCalled()
  })

  it('after a failed mistaken detach, the correct detach still works (the binding record wasn\'t corrupted)', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)

    removeEventListener(el, 'click', b)   // no-op
    removeEventListener(el, 'click', a)   // really detached
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(a).not.toHaveBeenCalled()
  })

  it('after rebinding, detaching by the new handler (the binding record follows along)', () => {
    const el = document.createElement('button')
    const a = vi.fn()
    const b = vi.fn()
    addEventListener(el, 'click', a)
    addEventListener(el, 'click', b)            // rebind replaces

    removeEventListener(el, 'click', a)  // old handler: no longer the current binding → no-op
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()

    removeEventListener(el, 'click', b)  // current binding → detach
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('with no binding record, falls back to one detach with the passed-in handler (direct renderer use still works)', () => {
    const el = document.createElement('button')
    const direct = vi.fn()
    const renderer = createDOMRenderer()
    renderer.addEventListener(el, 'click', direct)   // bind directly, bypassing bindEvent

    removeEventListener(el, 'click', direct)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(direct).not.toHaveBeenCalled()
  })

  it('multiple event types don\'t interfere with each other', () => {
    const el = document.createElement('button')
    const onClick = vi.fn()
    const onFocus = vi.fn()
    addEventListener(el, 'click', onClick)
    addEventListener(el, 'focus', onFocus)

    removeEventListener(el, 'click', onClick)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new FocusEvent('focus'))
    expect(onClick).not.toHaveBeenCalled()
    expect(onFocus).toHaveBeenCalledTimes(1)
  })
})
