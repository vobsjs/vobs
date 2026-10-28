// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { compile } from '@vobs/compiler'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { isPropertyName } from './dom-props'
import { bindSpreadProps, createElement, setProperty, setStaticProps, spreadProps } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * Both are the old problem of "compile-time and runtime each writing their own copy, and
 * disagreeing" (.artifacts/reports/runtime.supplement.md drawbacks 2/3).
 * `dom-props.ts:1-8` claims both sides have been consolidated into a single source, but
 * that only covered **prop names**, not **event names**, and in the prop-name table
 * `autofocus` used DOM lowercase, contradicting the same table's readOnly/tabIndex
 * convention.
 */
describe('on* event names: the runtime must use the same alias table as the compiler', () => {
  it('spread onDoubleClick attaches dblclick, not the nonexistent doubleclick', async () => {
    const calls: string[] = []
    const props = { onDoubleClick: () => calls.push('dbl') }
    const el = createElement('div')
    spreadProps(el, props)

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    // Before the fix: the real event name was "doubleclick", dblclick hit 0 times (callback never fires, silently)
    expect(calls).toEqual(['dbl'])
  })

  it('onDoubleClick\'s "hidden listener" doesn\'t exist (nothing attaches to doubleclick anymore)', () => {
    const calls: string[] = []
    const el = createElement('div')
    spreadProps(el, { onDoubleClick: () => calls.push('dbl') })
    el.dispatchEvent(new Event('doubleclick', { bubbles: true }))
    expect(calls).toEqual([])
  })

  it('custom event onMyEvent keeps case semantics (lowercases myEvent to myevent, nothing else)', () => {
    const calls: string[] = []
    const el = createElement('div')
    spreadProps(el, { onMyEvent: () => calls.push('custom') })
    el.dispatchEvent(new Event('myevent', { bubbles: true }))
    expect(calls).toEqual(['custom'])
  })

  it('replacing onDoubleClick in an identity-stable spread detaches the old listener', async () => {
    const calls: string[] = []
    const first = state<() => void>(() => calls.push('first'))
    const props = { get onDoubleClick() { return first.value } }
    const el = createElement('div')
    bindSpreadProps(el, () => props)
    await flush()

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(calls).toEqual(['first'])

    first.value = () => calls.push('second')
    await flush()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(calls).toEqual(['first', 'second'])
  })

  it('compiled output runs directly: onDoubleClick really works', () => {
    // Note compile() returns the **code string** directly (not { code })
    const output = compile(
      'export const A = (props) => <div onDoubleClick={props.hit} />',
      { filename: 'a.tsx' }
    )
    expect(output).toContain('"dblclick"')
    expect(output).not.toContain('"doubleclick"')
  })
})

describe('autoFocus={false} must not auto-focus the element', () => {
  /*
   * The criterion is **attribute presence**, not `el.autofocus`:
   * measured — the IDL of both jsdom and real DOM doesn't reflect autofocus
   * (`el.autofocus = true` is a no-op: creates no attribute, changes no value), so the
   * property channel silently fails here — the fix must go through the attribute channel.
   * And autofocus's semantics are "focus when the **attribute is present**", regardless
   * of its value, so `String(false)` writing `autofocus="false"` would make
   * `autoFocus={false}` **really auto-focus**.
   */
  it('autoFocus={false} must not leave an autofocus attribute', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autoFocus: false })
    // Before the fix: attribute channel → String(false) → autofocus="false" → still auto-focused
    expect(node.hasAttribute('autofocus')).toBe(false)
  })

  it('the attribute exists when autoFocus is true (presence = focus)', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autoFocus: true })
    expect(node.hasAttribute('autofocus')).toBe(true)
  })

  it('autoFocus goes through the property channel and maps to the all-lowercase IDL name', () => {
    /*
     * This once asserted `domAttributeName('autoFocus') === 'autofocus'` (an attribute
     * alias). That approach was **wrong**: `autofocus` is a boolean attribute, and the
     * attribute channel serializes false into `autofocus="false"` — "presence = focus"
     * meant `autoFocus={false}` would really focus. The correct path is the property
     * channel (the attribute is correctly removed via IDL reflection).
     */
    expect(isPropertyName('autoFocus')).toBe(true)
    // But the IDL name is all-lowercase `autofocus` — Reflect.set with the camelCase name only hangs an expando (silently ineffective)
    const el = document.createElement('input') as HTMLInputElement
    setProperty(el, 'autoFocus', true)
    expect(el.hasAttribute('autofocus')).toBe(true)
    expect(el.autofocus).toBe(true)
    setProperty(el, 'autoFocus', false)
    expect(el.hasAttribute('autofocus')).toBe(false)
    expect(el.autofocus).toBe(false)
  })

  it('false values in a spread don\'t set the attribute (both initial and incremental)', async () => {
    const flag = state(false)
    const props = { get autoFocus() { return flag.value } }
    const el = createElement('input')
    bindSpreadProps(el, () => props)
    await flush()
    // This is the defect itself: before the fix `String(false)` wrote autofocus="false" → still auto-focused
    expect(el.hasAttribute('autofocus')).toBe(false)

    // The attribute exists when truthy (presence = focus)
    flag.value = true
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(true)
  })

  it('removing the autoFocus key from a spread removes the attribute', async () => {
    const present = state(true)
    const props = new Proxy({} as Record<string, unknown>, {
      ownKeys: () => (present.value ? ['autoFocus'] : []),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: true }),
      get: (_t, key) => (key === 'autoFocus' ? true : undefined)
    })
    const el = createElement('input')
    bindSpreadProps(el, () => props)
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(true)

    present.value = false
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(false)
  })

  it('lowercase autofocus also goes through the property channel (the legacy spelling can\'t be a different semantic)', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autofocus: false })
    expect(node.hasAttribute('autofocus')).toBe(false)
  })
})
