// @vitest-environment jsdom
/*
 * The focus trap must only count elements that are **actually focusable**.
 *
 * `focusable()` used to filter only `disabled` and `aria-hidden="true"`, so elements inside
 * `hidden`, `display:none`, `visibility:hidden`, `tabindex="-1"`, and `inert` subtrees were
 * **all** counted as focusable.
 *
 * The consequence wasn't just "focus lands on a hidden element". The Tab cycle uses the
 * `first`/`last` endpoints: when **hidden elements trail the last visible one**, `last` is
 * computed as that hidden element — the user pressing Tab on the last visible element sends
 * focus into the invisible region (manifesting as "focus disappears").
 * That is exactly the shape the first case in this file locks in.
 *
 * ⚠️ "Hidden" is judged only from inline styles and the `hidden` attribute, without
 * `getComputedStyle` (jsdom doesn't load external stylesheets; and forcing style computation
 * on every Tab is too expensive).
 * Hiding caused by classes / external stylesheets is not detected — use `hidden` or
 * `aria-hidden="true"` for that.
 */
import { describe, expect, it } from 'vitest'
import { createFocusTrap } from './overlay'

interface Fixture { root: HTMLElement; outside: HTMLButtonElement; cleanup: () => void }

function fixture(): Fixture {
  const root = document.createElement('div')
  const outside = document.createElement('button')
  outside.textContent = 'outside'
  document.body.append(outside, root)
  return {
    root,
    outside,
    cleanup: () => { root.remove(); outside.remove() }
  }
}

function button(label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.textContent = label
  return el
}

function pressTab(root: HTMLElement, shift = false): void {
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }))
}

describe('focus trap: invisible elements must not count as focusable', () => {
  it('a hidden element at the end is not treated as last (Tab does not land in the invisible region)', () => {
    const f = fixture()
    const first = button('first')
    const visible = button('visible')
    const hidden = button('hidden')
    hidden.hidden = true
    f.root.append(first, visible, hidden)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)

    visible.focus()
    pressTab(f.root)
    // Before the fix: last was computed as hidden → focus either stayed put or landed on hidden; now it should return to first
    expect(document.activeElement, 'Tab sent focus into a hidden element').toBe(first)
    expect(document.activeElement).not.toBe(hidden)

    trap.dispose()
    f.cleanup()
  })

  it('display:none elements do not participate', () => {
    const f = fixture()
    const first = button('first')
    const gone = button('gone')
    gone.style.display = 'none'
    f.root.append(first, gone)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)

    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('visibility:hidden elements do not participate', () => {
    const f = fixture()
    const first = button('first')
    const invisible = button('invisible')
    invisible.style.visibility = 'hidden'
    f.root.append(first, invisible)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('children do not participate when an ancestor is display:none', () => {
    const f = fixture()
    const first = button('first')
    const wrap = document.createElement('div')
    wrap.style.display = 'none'
    const child = button('child')
    wrap.append(child)
    f.root.append(first, wrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('tabindex="-1" is out of the Tab sequence (but still programmatically focusable)', () => {
    const f = fixture()
    const first = button('first')
    const programmatic = button('programmatic')
    programmatic.setAttribute('tabindex', '-1')
    f.root.append(first, programmatic)
    // Confirm it is indeed programmatically focusable (otherwise this test is meaningless)
    programmatic.focus()
    expect(document.activeElement).toBe(programmatic)

    const trap = createFocusTrap(f.root)
    trap.activate()
    first.focus()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('elements inside an inert subtree do not participate', () => {
    const f = fixture()
    const first = button('first')
    const inertWrap = document.createElement('div')
    inertWrap.setAttribute('inert', '')
    const inertButton = button('inert')
    inertWrap.append(inertButton)
    f.root.append(first, inertWrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('an aria-hidden="true" ancestor is excluded too (existing semantics preserved)', () => {
    const f = fixture()
    const first = button('first')
    const ariaWrap = document.createElement('div')
    ariaWrap.setAttribute('aria-hidden', 'true')
    const ariaButton = button('aria')
    ariaWrap.append(ariaButton)
    f.root.append(first, ariaWrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('Shift+Tab wraps from the first visible element to the **last visible** element', () => {
    const f = fixture()
    const first = button('first')
    const lastVisible = button('lastVisible')
    const hiddenAtEnd = button('hiddenAtEnd')
    hiddenAtEnd.hidden = true
    f.root.append(first, lastVisible, hiddenAtEnd)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)
    pressTab(f.root, true)
    expect(document.activeElement, 'Shift+Tab wrapped into a hidden element').toBe(lastVisible)
    trap.dispose()
    f.cleanup()
  })

  it('visible elements still cycle normally (the feature was not broken along the way)', () => {
    const f = fixture()
    const first = button('first')
    const last = button('last')
    f.root.append(first, last)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)
    last.focus()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)     // forward wrap
    first.focus()
    pressTab(f.root, true)
    expect(document.activeElement).toBe(last)      // backward wrap
    trap.dispose()
    f.cleanup()
  })

  it('when no element is visible, Tab does not send focus out of the trap', () => {
    const f = fixture()
    const hidden = button('hidden')
    hidden.hidden = true
    f.root.append(hidden)
    f.root.setAttribute('tabindex', '-1')

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    // With no focusable element, the code path hands focus to the root and calls preventDefault
    expect(document.activeElement).toBe(f.root)
    expect(document.activeElement).not.toBe(f.outside)
    trap.dispose()
    f.cleanup()
  })
})
