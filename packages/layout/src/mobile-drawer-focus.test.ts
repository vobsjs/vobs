// @vitest-environment jsdom
/*
 * After the mobile drawer closes, links inside the sidebar must **not remain
 * tabbable**.
 *
 * On mobile the sidebar is **off-screen CSS positioning** (it slides in/out
 * via the `vobs-kit-layout--mobile-open` class on the root). With the drawer
 * closed it's still in the DOM and merely moved out of the viewport — and the
 * original `bindVisibility(sidebar, sidebarVisible)` **ignored `mobileOpen`
 * entirely**, so keyboard users pressed Tab and landed inside invisible
 * navigation (`aria-hidden` doesn't stop keyboard focus either).
 *
 * Two independent fixes, locked separately:
 * 1. `bindVisibility` gains `inert` — hidden subtrees leave **the focus order
 *    and the accessibility tree**
 * 2. sidebar visibility now factors in `mobileOpen` — drawer closed on mobile
 *    means invisible
 *
 * jsdom's `window.innerWidth` defaults to 1024, so `mobileBreakpoint` is set
 * above that to enter mobile mode (the existing `breakpoint.test.ts` uses the
 * same trick).
 */
import { describe, expect, it } from 'vitest'
import { state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())

function mount(options: { startOpen: boolean }) {
  const open = state(options.startOpen)
  const container = document.createElement('main')
  const link = createElement('a')
  link.setAttribute('href', '#nav')
  const sidebar = createElement('aside')
  sidebar.append(link)
  const app = createVobs({
    render: () => createComponent(KitLayout, {
      // above jsdom's default 1024 → mobile mode
      mobileBreakpoint: 1400,
      sidebar,
      get mobileOpen() { return open.value },
      children: 'Content'
    })
  })
  app.mount(container)
  const sidebarEl = (): HTMLElement => container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
  return { app, container, open, sidebarEl, cleanup: () => { app.destroy(); container.remove() } }
}

describe('mobile drawer: a closed sidebar must not stay in the tab order', () => {
  it('closing the drawer on mobile → sidebar inert + aria-hidden + hidden', () => {
    const f = mount({ startOpen: false })
    const sidebar = f.sidebarEl()
    expect(sidebar, 'sidebar not found').toBeTruthy()
    expect(sidebar.hasAttribute('inert'), 'the closed sidebar is still tabbable').toBe(true)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(sidebar.hidden).toBe(true)
    f.cleanup()
  })

  it('opening the drawer on mobile → sidebar focusable (functionality not killed along with it)', () => {
    const f = mount({ startOpen: true })
    const sidebar = f.sidebarEl()
    expect(sidebar.hasAttribute('inert')).toBe(false)
    expect(sidebar.getAttribute('aria-hidden')).toBeNull()
    expect(sidebar.hidden).toBe(false)
    f.cleanup()
  })

  it('inert follows open → close → open correctly (not computed only at mount)', () => {
    const f = mount({ startOpen: true })
    const sidebar = f.sidebarEl()
    expect(sidebar.hasAttribute('inert')).toBe(false)

    f.open.value = false
    f.app.update()
    expect(sidebar.hasAttribute('inert'), 'inert not added after closing the drawer').toBe(true)

    f.open.value = true
    f.app.update()
    expect(sidebar.hasAttribute('inert'), 'inert not removed after reopening').toBe(false)
    f.cleanup()
  })

  it('desktop (non-mobile breakpoint) is unaffected: visible means no inert', () => {
    const open = state(false)     // mobile drawer state is closed, but this isn't mobile
    const container = document.createElement('main')
    const sidebar = createElement('aside')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        mobileBreakpoint: 100,     // below 1024 → desktop mode
        sidebar,
        get mobileOpen() { return open.value },
        children: 'Content'
      })
    })
    app.mount(container)
    const sidebarEl = container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
    // The desktop sidebar is visible anyway and must not be made inert because mobileOpen=false
    expect(sidebarEl.hasAttribute('inert'), 'desktop collateral damage from the mobile state').toBe(false)
    expect(sidebarEl.hidden).toBe(false)
    app.destroy()
    container.remove()
  })

  it('a null sidebar slot → still hidden + inert (consistent hidden semantics)', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        mobileBreakpoint: 1400,
        sidebar: null,
        children: 'Content'
      })
    })
    app.mount(container)
    const sidebarEl = container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
    expect(sidebarEl.hidden).toBe(true)
    expect(sidebarEl.hasAttribute('inert')).toBe(true)
    app.destroy()
    container.remove()
  })

  it('other hidden regions (header/breadcrumb/tabs) also carry inert', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        header: null,
        breadcrumb: null,
        tabs: null,
        sidebar: null,
        children: 'Content'
      })
    })
    app.mount(container)
    for (const selector of ['.vobs-kit-layout__header', '.vobs-kit-layout__breadcrumb', '.vobs-kit-layout__tabs']) {
      const el = container.querySelector(selector) as HTMLElement
      if (!el) continue
      expect(el.hidden, `${selector} not hidden`).toBe(true)
      expect(el.hasAttribute('inert'), `${selector} hidden but without inert`).toBe(true)
    }
    app.destroy()
    container.remove()
  })
})
