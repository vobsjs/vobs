// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createComponent } from '@vobs/runtime'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * `mobileBreakpoint` must be reactive.
 *
 * KitLayout used to compute `normalizeBreakpoint(readProp(props,
 * 'mobileBreakpoint', …))` once in the component body and hand the **number**
 * to createKitViewport — component bodies run once, so changing the breakpoint
 * afterwards had no effect: verified that switching from 768 to 600 didn't
 * remove the `vobs-kit-layout--mobile` class.
 *
 * The breakpoint is now a memo and the viewport receives a getter; the
 * viewport reads it inside the `isMobile` memo — a breakpoint change moves
 * isMobile with it. Both directions are asserted here.
 *
 * jsdom's window.innerWidth defaults to 1024.
 */
const INNER_WIDTH = 1024

function mount(initialBreakpoint: number) {
  const breakpoint = state(initialBreakpoint)
  const props: Parameters<typeof KitLayout>[0] = { get mobileBreakpoint() { return breakpoint.value } }
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(KitLayout, props) })
  app.mount(host)
  const root = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-kit-layout')
  const isMobile = (): boolean => root()?.classList.contains('vobs-kit-layout--mobile') ?? false
  return { breakpoint, root, isMobile, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitLayout mobileBreakpoint reactivity', () => {
  it('enters the mobile layout when the breakpoint rises above the window width and exits when lowered back', async () => {
    const { breakpoint, isMobile, cleanup } = mount(600)
    await settle()
    expect(INNER_WIDTH).toBeGreaterThan(600)
    expect(isMobile()).toBe(false)

    breakpoint.value = 2000                      // 1024 < 2000 → mobile layout
    await settle()
    expect(isMobile()).toBe(true)

    breakpoint.value = 600                       // back down → should exit (it used to stay true here)
    await settle()
    expect(isMobile()).toBe(false)

    cleanup()
  })
})
