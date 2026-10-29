// @vitest-environment jsdom
/*
 * The numeric input parsing contract (external pitfall doc #7).
 *
 * Core fact: `Number('') === 0` — the instant the user clears the input box, the value is
 * written into the signal as 0. In "ratio locking / linked calculation" chains that 0 becomes
 * `Infinity` through division and zeroes the sibling dimensions too:
 * **clearing one input box zeroes several neighboring ones as well**.
 *
 * Contract: numerically semantic input goes through `parseNumber` — empty / invalid /
 * out-of-bounds values are **never committed**; the signal keeps the last valid value.
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createForm, Field, parseNumber, describeNumberParseFailure } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('parseNumber', () => {
  it('**empty string is not committed** (the primary reason it exists)', () => {
    expect(parseNumber('').ok).toBe(false)
    expect(parseNumber('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseNumber('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('invalid shapes are not committed (no Number()-style lenient parsing)', () => {
    for (const text of ['abc', '1.2.3', '--1', '1,000', '12px', '1e3', '0x10', 'Infinity', 'NaN']) {
      const result = parseNumber(text)
      expect(result.ok, `${JSON.stringify(text)} was unexpectedly accepted`).toBe(false)
    }
  })

  it('valid decimal input is committed as usual', () => {
    expect(parseNumber('0')).toEqual({ ok: true, value: 0 })
    expect(parseNumber('42')).toEqual({ ok: true, value: 42 })
    expect(parseNumber('-1.5')).toEqual({ ok: true, value: -1.5 })
    expect(parseNumber('+3')).toEqual({ ok: true, value: 3 })
    expect(parseNumber('.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseNumber(' 7 ')).toEqual({ ok: true, value: 7 })
  })

  it('the mid-typing state `1.` is accepted by default (rejecting it makes typing awkward)', () => {
    expect(parseNumber('1.')).toEqual({ ok: true, value: 1 })
    expect(parseNumber('1.', { allowTrailingDot: false }).ok).toBe(false)
  })

  it('out-of-bounds is **not committed** (not silently clamped — clamping masks user input)', () => {
    expect(parseNumber('101', { max: 100 })).toEqual({ ok: false, reason: 'above-max' })
    expect(parseNumber('-1', { min: 0 })).toEqual({ ok: false, reason: 'below-min' })
    // boundary values themselves are valid (endpoints included)
    expect(parseNumber('100', { max: 100 })).toEqual({ ok: true, value: 100 })
    expect(parseNumber('0', { min: 0 })).toEqual({ ok: true, value: 0 })
  })

  it('the integer option rejects decimals', () => {
    expect(parseNumber('1.5', { integer: true })).toEqual({ ok: false, reason: 'not-integer' })
    expect(parseNumber('2', { integer: true })).toEqual({ ok: true, value: 2 })
  })

  it('overlong numbers (shape-valid but overflowing to Infinity) are blocked', () => {
    expect(parseNumber('1'.repeat(400)).ok).toBe(false)
  })

  it('every failure reason has a user-facing message', () => {
    for (const reason of ['empty', 'invalid', 'not-integer', 'below-min', 'above-max'] as const) {
      expect(describeNumberParseFailure(reason).length).toBeGreaterThan(0)
    }
  })
})

describe('Field type="number" does not write an empty string as 0', () => {
  function mountNumericField(initial: unknown, extra: Record<string, unknown> = {}) {
    const form = createForm({ get ratio() { return initial } } as never)
    const onInvalid = vi.fn()
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Field, {
        form,
        name: 'ratio',
        type: 'number',
        onNumberInvalid: onInvalid,
        ...extra
      } as never)
    })
    app.mount(host)
    settle()
    const input = host.querySelector('input') as HTMLInputElement
    return { form, host, app, input, onInvalid, cleanup: () => { app.destroy(); host.remove() } }
  }

  it('clearing the input does **not** turn the value into 0 (the original shape of the pit)', () => {
    const view = mountNumericField(50)
    expect(view.input.value).toBe('50')

    view.input.value = ''
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()

    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value, 'empty string treated as 0 — the linked chain would be zeroed').toBe(50)
    expect(view.input.value).toBe('')     // the box still shows the user-cleared state (that is the input's own representation)
    view.cleanup()
  })

  it('invalid input is not committed and the caller is notified with the reason', () => {
    const view = mountNumericField(50)
    /*
     * Note: `<input type="number">` **rejects invalid text on its own** —
     * assigning `.value = 'abc'` gets normalized to `''` by the browser, so what reaches us here
     * is `empty`, not `invalid`.
     * (`invalid` is covered directly by `parseNumber`, see the pure-function cases above —
     * only the text box + numeric-hint combination actually receives 'abc'.)
     */
    view.input.value = 'abc'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()

    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value, 'invalid input was committed').toBe(50)
    expect(view.onInvalid).toHaveBeenCalledWith('empty', '')
    view.cleanup()
  })

  it('a text box with numeric hints (min/max) receives truly invalid text', () => {
    const view = mountNumericField(50, { type: 'text', min: 0, max: 100 })
    view.input.value = 'abc'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(50)
    expect(view.onInvalid).toHaveBeenCalledWith('invalid', 'abc')
    view.cleanup()
  })

  it('out-of-bounds is not committed', () => {
    const view = mountNumericField(50, { max: 100 })
    view.input.value = '101'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(50)
    view.cleanup()
  })

  it('a valid number is **committed as a number type** (not a string)', () => {
    const view = mountNumericField(50)
    view.input.value = '75'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(75)
    expect(typeof field.value.value, 'the number box committed a string; the caller\'s first division breaks').toBe('number')
    view.cleanup()
  })

  it('a text box (no numeric semantics) behaves unchanged — the string is still written as-is', () => {
    const form = createForm({ get note() { return 'x' } } as never)
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Field, { form, name: 'note', type: 'text' } as never)
    })
    app.mount(host)
    settle()
    const input = host.querySelector('input') as HTMLInputElement
    input.value = 'any text'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = form.field('note' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe('any text')
    app.destroy(); host.remove()
  })

  it('onNumberInvalid does not land as a DOM attribute', () => {
    const view = mountNumericField(50)
    expect(view.input.hasAttribute('onnumberinvalid')).toBe(false)
    view.cleanup()
  })
})
