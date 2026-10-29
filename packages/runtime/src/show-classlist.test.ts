// @vitest-environment jsdom
/*
 * `Show` + `classList` — the countermeasure for external postmortem doc item C, from
 * "human discipline" to one line.
 *
 * Item C: input controls inside conditional branches lose focus — `insertDynamic`
 * compares by reference (`next === current`), so a change of the condition expression
 * **rebuilds the subtree**, and focus is lost on every keystroke, along with scroll
 * position and internal state.
 *
 * The criteria use **node identity + focus** (not "does it look right"):
 * - after the condition flips back and forth, the input element is **still the same object**
 * - `document.activeElement` is always it (focus never lost)
 * - the value in the input was not reset
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { applyClassList, bindAttribute, setStaticProps, Show } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('Show: keeps mounted, condition changes never rebuild the subtree', () => {
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

  it('after condition toggles the input element is **still the same object** (not rebuilt)', () => {
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
    expect(view.input(), 'Show rebuilt the subtree (exactly the item-C bug)').toBe(before)
    view.cleanup()
  })

  it('condition toggles neither lose focus nor reset the input value', () => {
    const open = state(true)
    const view = mountShow(() => open.value)
    const input = view.input()!
    input.focus()
    input.value = 'user-entered content'
    expect(document.activeElement).toBe(input)

    open.value = false
    settle()
    open.value = true
    settle()

    expect(document.activeElement, 'the condition change lost focus').toBe(input)
    expect(input.value, 'the condition change reset the user\'s input').toBe('user-entered content')
    view.cleanup()
  })

  it('hidden carries hidden + inert while hidden (out of focus order and the accessibility tree)', () => {
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
    expect(input.hasAttribute('inert'), 'inert was not removed after showing again').toBe(false)
    view.cleanup()
  })

  it('hiddenClass adds/removes as needed and doesn\'t touch the author\'s own class names', () => {
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
    expect(el.getAttribute('class'), 'the author\'s class names were wiped').toBe('panel custom')
    app.destroy(); host.remove()
  })

  it('children not a single element → throws and explains what to do (no silent degradation)', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)
    expect(() => {
      createVobs({
        render: () => createComponent(Show, {
          when: true,
          children: 'plain text' as unknown as VobsNode
        } as never)
      }).mount(host)
    }).toThrowError(/single element/u)
    host.remove()
  })

  it('children empty → throws', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)
    expect(() => {
      createVobs({ render: () => createComponent(Show, { when: true } as never) }).mount(host)
    }).toThrowError(/cannot be empty/u)
    host.remove()
  })
})

describe('classList: one line replacing hand-built class name strings', () => {
  it('object form: truthy adds a class, falsy doesn\'t', () => {
    const el = createElement('div')
    applyClassList(el, { 'is-open': true, 'is-busy': false, 'is-ready': 1 })
    expect(el.getAttribute('class')).toBe('is-open is-ready')
  })

  it('array form with conditional entries', () => {
    const el = createElement('div')
    applyClassList(el, ['base', false, null, undefined, 'extra'])
    expect(el.getAttribute('class')).toBe('base extra')
  })

  it('repeated toggling **never accumulates**, and never wipes the author\'s class', () => {
    const el = createElement('div')
    el.setAttribute('class', 'panel')
    applyClassList(el, { 'is-open': true })
    expect(el.getAttribute('class')).toBe('panel is-open')
    applyClassList(el, { 'is-open': false })
    expect(el.getAttribute('class')).toBe('panel')
    applyClassList(el, { 'is-open': true })
    expect(el.getAttribute('class'), 'class names stacked up after repeated toggling').toBe('panel is-open')
  })

  it('goes through the real props channel (setStaticProps) too — proving the wiring, not just the algorithm', () => {
    const el = createElement('div')
    setStaticProps(el, { class: 'panel', classList: { 'is-open': true, 'is-busy': false } })
    expect(el.getAttribute('class')).toBe('panel is-open')
    // Must not write a `classlist` attribute the browser doesn't know
    expect(el.hasAttribute('classlist')).toBe(false)
  })

  it('goes through the compiler\'s real compiled-output path (bindAttribute) reactively too', () => {
    // Measured compiled output: classList={{...}} → bindAttribute(_el0, "classList", () => ({...}))
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
    expect(el.getAttribute('class'), 'class names stacked up after repeated toggling').toBe('panel is-open')
  })

  it('empty object / empty array clears the classes it contributed', () => {
    const el = createElement('div')
    el.setAttribute('class', 'panel')
    applyClassList(el, { 'is-open': true })
    applyClassList(el, {})
    expect(el.getAttribute('class')).toBe('panel')
  })
})
