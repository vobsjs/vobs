// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Dialog, Drawer } from './index'

setRenderer(createDOMRenderer())
const flush = () => { scheduler.flush(); scheduler.flush() }

/*
 * Focus management for Dialog / Drawer.
 *
 * Both used to declare `aria-modal="true"` while having **no focus management at all** — the
 * focus trap was implemented, tested, and exported in overlay.ts, but no component used it
 * (across the repo only its own tests called it). The consequences were real:
 *   - Focus stayed on the trigger button outside the overlay → the Escape keydown never reached
 *     the listener on the component root → "pressing Esc doesn't close it"
 *   - Tab moved into the content behind the overlay
 *   - Focus did not return to the opening element after close
 *
 * This locks in four things: focus moves in, Escape works, focus restores on close, and
 * **non-modal does not trap**.
 */
function mountOverlay(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()

  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  flush()

  const cleanup = (): void => { app.destroy(); host.remove(); trigger.remove() }
  return { host, trigger, cleanup }
}

describe('Dialog/Drawer focus management', () => {
  it('moves focus into the overlay on open and delivers Escape (previously focus stayed outside → Esc was ineffective)', () => {
    const open = state(false)
    const closes: string[] = []
    const props = { get open() { return open.value }, onClose: (reason: string) => closes.push(reason) }
    const { host, cleanup } = mountOverlay(Dialog, props)

    open.value = true
    flush()
    expect(host.contains(document.activeElement)).toBe(true)

    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flush()
    expect(closes).toEqual(['escape'])

    cleanup()
  })

  it('restores focus to the opening element after close', () => {
    const open = state(false)
    const { trigger, cleanup } = mountOverlay(Dialog, { get open() { return open.value } })

    open.value = true
    flush()
    open.value = false
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('non-modal dialog does not steal focus (consistent with the aria-modal check)', () => {
    const open = state(false)
    const { trigger, cleanup } = mountOverlay(Dialog, { get open() { return open.value }, modal: false })

    open.value = true
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('Drawer has the same focus management (not just Dialog)', () => {
    const open = state(false)
    const { host, trigger, cleanup } = mountOverlay(Drawer, { get open() { return open.value } })

    open.value = true
    flush()
    expect(host.contains(document.activeElement)).toBe(true)

    open.value = false
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })
})
