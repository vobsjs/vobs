// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, useDismiss } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { state } from '@vobs/reactivity'

const down = (target: Element): void => {
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

/*
 * useDismiss (the standard overlay "close on outside click" primitive; the §8 cure).
 *
 * Call shape = **inside a component body** (the Owner is automatically attached to the
 * component tree: unmounting the component cascade-cleans the document listeners).
 * Tests uniformly mount via createComponent, isomorphic with real usage.
 */
function mountPopup(options: Record<string, unknown> = {}): {
  host: HTMLElement
  popup: HTMLElement
  open: ReturnType<typeof state<boolean>>
  unmount: () => void
} {
  const host = document.createElement('div')
  document.body.append(host)
  const open = state(true)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(() => {
      if (!open.value) return null
      const popup = document.createElement('div')
      popup.className = 'popup'
      const item = document.createElement('button')
      popup.append(item)
      useDismiss(popup, () => { open.value = false }, options)
      return popup
    }, {})
  })
  app.mount(host)
  const popup = host.querySelector('.popup') as HTMLElement
  return { host, popup, open, unmount: () => app.destroy() }
}

describe('useDismiss (the standard overlay "close on outside click" primitive, §8 cure)', () => {
  it('outside click closes; clicks inside the overlay do not (menu item click doesn\'t land on a dead node)', () => {
    const { host, popup, open, unmount } = mountPopup()
    const item = popup.querySelector('button') as HTMLElement

    // Click inside the overlay (including mousedown) — no close; the menu item's own handler deals with click
    down(popup)
    down(item)
    expect(open.value).toBe(true)
    expect(host.contains(popup)).toBe(true)

    // Outside click — close
    down(document.body)
    expect(open.value).toBe(false)
    unmount()
  })

  it('also nodes (trigger buttons) count as inside — the opening click doesn\'t immediately self-close', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const trigger = document.createElement('button')
    host.append(trigger)
    const popup = document.createElement('div')
    host.append(popup)

    let closeCount = 0
    const owner = createVobs({
      renderer: createDOMRenderer(),
      render: () => createComponent(() => {
        useDismiss(popup, () => { closeCount++ }, { also: [trigger] })
        return popup
      }, {})
    })
    owner.mount(host)

    down(trigger)
    expect(closeCount).toBe(0)
    down(popup)
    expect(closeCount).toBe(0)
    down(document.body)
    expect(closeCount).toBe(1)
    owner.destroy()
    host.remove()
  })

  it('Escape closes (can be disabled)', () => {
    const { open, unmount } = mountPopup()
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(open.value).toBe(false)
    unmount()

    // No reaction when escape: false
    const second = mountPopup({ escape: false })
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(second.open.value).toBe(true)
    second.unmount()
  })

  it('keepFocusInside: mousedown inside the overlay is preventDefault\'d (keeps the input selection), outside clicks are not intercepted', () => {
    const host = document.createElement('div')
    document.body.append(host)
    let prevented = 0
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => createComponent(() => {
        const popup = document.createElement('div')
        const input = document.createElement('input')
        popup.append(input)
        popup.addEventListener('mousedown', e => {
          if (e.defaultPrevented) prevented++
        })
        useDismiss(popup, () => {}, { keepFocusInside: true })
        return popup
      }, {})
    })
    app.mount(host)
    const input = host.querySelector('input') as HTMLElement

    down(input)
    expect(prevented).toBe(1)

    const outside = document.createElement('div')
    document.body.append(outside)
    down(outside)
    expect(prevented).toBe(1)
    app.destroy()
    outside.remove()
  })

  it('component unmount cascade-cleans the document listeners (outside clicks no longer trigger close)', () => {
    const { open, unmount } = mountPopup()
    expect(open.value).toBe(true)
    unmount()
    down(document.body)
    // The Owner was cascade-destroyed with the component unmount: listeners removed, close
    // no longer triggered (open keeps its initial value)
    expect(open.value).toBe(true)
  })
})
