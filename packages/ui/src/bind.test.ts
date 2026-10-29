// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Checkbox, Input, Radio, Select, Switch, Textarea } from './index'

/*
 * bind two-way binding.
 *
 * This area once had **no tests at all** — the only bind test in the whole repo lived in Combobox
 * (which doesn't go through the form-control path). So this bug stayed hidden: `listen` created a
 * fresh wrapper function on every call, while the runtime's `addEventListener` has only one slot
 * per (node, event); the later registration (user handler) evicted the earlier one (bind
 * write-back) — after typing, the signal never changed, and with zero errors.
 *
 * So this group of tests locks in two things at once: **write-back works** and **the user handler
 * is still called**.
 */
const flush = () => { scheduler.flush(); scheduler.flush() }

function mountControl(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const host = document.createElement('div')
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  flush()
  return { host, app }
}

describe('bind write-back', () => {
  it('Input: typing writes back to the signal, and the user onInput still fires', () => {
    const value = state('初始')
    const seen: string[] = []
    const { host, app } = mountControl(Input, {
      bind: value,
      onInput: (event: Event) => seen.push((event.target as HTMLInputElement).value)
    })
    const input = host.querySelector('input') as HTMLInputElement
    input.value = 'typed'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    flush()

    expect(value.value).toBe('typed')
    expect(seen).toEqual(['typed'])
    app.destroy()
  })

  it('Textarea: typing writes back to the signal', () => {
    const value = state('初始')
    const { host, app } = mountControl(Textarea, { bind: value })
    const el = host.querySelector('textarea') as HTMLTextAreaElement
    el.value = 'typed'
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
    flush()

    expect(value.value).toBe('typed')
    app.destroy()
  })

  it('Checkbox: checking writes a boolean back to the signal', () => {
    const checked = state(false)
    const { host, app } = mountControl(Checkbox, { bind: checked })
    const el = host.querySelector('input[type=checkbox]') as HTMLInputElement
    el.checked = true
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    flush()

    expect(checked.value).toBe(true)
    app.destroy()
  })

  it('Signal → DOM: signal changes via bind write back to the control (reverse direction too)', () => {
    const value = state('a')
    const { host, app } = mountControl(Input, { bind: value })
    const input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('a')

    value.value = 'b'
    flush()
    expect(input.value).toBe('b')
    app.destroy()
  })

  it('Switch: toggling writes a boolean back to the signal', () => {
    const checked = state(false)
    const { host, app } = mountControl(Switch, { bind: checked })
    const el = host.querySelector('input[type=checkbox]') as HTMLInputElement
    el.checked = true
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    flush()
    expect(checked.value).toBe(true)
    app.destroy()
  })

  it('Select: change writes the selected value back', () => {
    const value = state('')
    const { host, app } = mountControl(Select, { bind: value })
    const el = host.querySelector('select') as HTMLSelectElement
    // Options would normally come from the children slot; here we only test event write-back
    // itself, so the DOM is injected directly.
    // (My previous probe passed `options` — a guessed props shape — which left the <select>
    //   without any option, so the test asserted "my assumption" instead of the subject under
    //   test, and nearly misreported the bug as unfixed.)
    el.innerHTML = '<option value="a">A</option><option value="b">B</option>'
    el.value = 'b'
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    flush()
    expect(value.value).toBe('b')
    app.destroy()
  })

  it('Radio: the bind contract is Signal<boolean>, writing a boolean back rather than the option value', () => {
    const checked = state(false)
    const { host, app } = mountControl(Radio, { bind: checked, value: 'x' })
    const el = host.querySelector('input[type=radio]') as HTMLInputElement
    el.checked = true
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    flush()
    expect(checked.value).toBe(true)
    app.destroy()
  })
})