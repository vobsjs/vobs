// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createComponent } from '@vobs/runtime'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * The default header's toggle button must trigger both onToggleSidebar and the
 * state callback.
 *
 * A deep-read report claimed "in controlled mode the default button only calls
 * onSidebarCollapsedChange; onToggleSidebar is only invoked by custom headers,
 * so apps wiring only onToggleSidebar saw no response". **Disproved by
 * measurement**: clicking the default header's
 * `.vobs-kit-header__toggle-button` fired each callback exactly once.
 *
 * The code path agrees: `createDefaultToggle` (header.ts:80-83) reads
 * KitHeader's onToggleSidebar, and KitHeader's prop comes from the wrapper in
 * `createHeaderSlot` that "first context.toggleSidebar(), then the author's
 * callback" (layout.ts:196-200) — and `createHeaderSlot` has a single call
 * site (layout.ts:136), so default and custom headers share one path.
 *
 * Since the verdict is "no such bug", this pins **the currently correct
 * contract** so it can't be broken silently later.
 */
function mount(props: NonNullable<Parameters<typeof KitLayout>[0]>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(KitLayout, props) })
  app.mount(host)
  const toggle = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-kit-header__toggle-button')
  const click = (): void => { toggle()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }
  return { host, toggle, click, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitLayout toggle callback contract', () => {
  it('controlled: the default header button calls both onToggleSidebar and onSidebarCollapsedChange', async () => {
    const toggles: number[] = []
    const changes: boolean[] = []
    const collapsed = state(false)
    const { click, cleanup } = mount({
      menu: [{ key: '/home', label: 'Home' }],
      get sidebarCollapsed() { return collapsed.value },
      onToggleSidebar: () => { toggles.push(1) },
      onSidebarCollapsedChange: (value: boolean) => { changes.push(value) }
    })
    await settle()

    click()
    await settle()
    expect(toggles).toHaveLength(1)
    expect(changes).toEqual([true])          // false → true (controlled; the author decides whether to adopt it)
    cleanup()
  })

  it('uncontrolled: the state callback fires too (the author can persist on it)', async () => {
    const changes: boolean[] = []
    const { host, click, cleanup } = mount({
      menu: [{ key: '/home', label: 'Home' }],
      onSidebarCollapsedChange: (value: boolean) => { changes.push(value) }
    })
    await settle()

    // Uncontrolled defaults to collapsed=true (sidebarExpanded defaults to false) → one click **expands**
    expect(host.querySelector('.vobs-kit-layout--sidebar-collapsed')).toBeTruthy()
    click()
    await settle()
    expect(host.querySelector('.vobs-kit-layout--sidebar-collapsed')).toBeNull()
    expect(changes).toEqual([false])
    cleanup()
  })
})
