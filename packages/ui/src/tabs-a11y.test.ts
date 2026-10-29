// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Tabs, type TabItem } from './index'

setRenderer(createDOMRenderer())

/*
 * Tabs accessibility: panel role + keyboard operation.
 *
 * There used to be only `role="tablist"`/`role="tab"` + mouse clicks:
 *   - The panel had **no role at all** (only the tab did) — screen readers couldn't tell
 *     "this is the tab page's content area"
 *   - Tab stopped on **every** tab in turn for keyboard users (no roving tabindex), and the
 *     arrow keys did nothing
 *   - Yet the presence of `role="tab"` made screen readers announce "arrow keys switch tabs" —
 *     the two sides didn't match
 *
 * Focus needs the update to land (selection re-renders the tab strip), so yield a microtask
 * before asserting.
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const ITEMS: TabItem[] = ['a', 'b', 'c'].map(id => ({
  id,
  label: id.toUpperCase(),
  content: () => createText(`panel ${id}`)
}))

async function mountTabs(changes: string[] = []) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(Tabs, { items: ITEMS, onChange: (id: string) => changes.push(id) })
  })
  app.mount(host)
  await settle()
  const buttons = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
  const selectedIndex = (): number => buttons().findIndex(b => b.getAttribute('aria-selected') === 'true')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, app, buttons, selectedIndex, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('Tabs accessibility', () => {
  it('the panel has role=tabpanel', async () => {
    const { host, cleanup } = await mountTabs()
    expect(host.querySelector('[role=tabpanel]')).toBeTruthy()
    cleanup()
  })

  it('roving tabindex: only the current tab is a Tab stop', async () => {
    const { buttons, cleanup } = await mountTabs()
    expect(buttons().map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    cleanup()
  })

  it('arrow keys change the selection and move focus along', async () => {
    const changes: string[] = []
    const { buttons, selectedIndex, press, cleanup } = await mountTabs(changes)

    buttons()[0].focus()
    await press('ArrowRight')
    expect(selectedIndex()).toBe(1)
    expect(changes).toEqual(['b'])
    expect(document.activeElement).toBe(buttons()[1])
    expect(buttons().map(b => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])

    cleanup()
  })

  it('wraps at both ends; Home/End jump straight there', async () => {
    const { buttons, selectedIndex, press, cleanup } = await mountTabs()

    buttons()[0].focus()
    await press('ArrowLeft')
    expect(selectedIndex()).toBe(2)          // left from the first → wraps to the last

    await press('ArrowRight')
    expect(selectedIndex()).toBe(0)          // right from the last → wraps to the first

    await press('End')
    expect(selectedIndex()).toBe(2)
    await press('Home')
    expect(selectedIndex()).toBe(0)

    cleanup()
  })

  it('arrow keys do not switch to disabled tabs', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const items: TabItem[] = [
      { id: 'a', label: 'A', content: () => createText('a') },
      { id: 'b', label: 'B', disabled: true, content: () => createText('b') },
      { id: 'c', label: 'C', content: () => createText('c') }
    ]
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(Tabs, { items }) })
    app.mount(host)
    await settle()

    const buttons = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
    buttons()[0].focus()
    await press0(buttons()[0])
    async function press0(el: HTMLElement): Promise<void> {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await settle()
    }
    const selected = buttons().findIndex(b => b.getAttribute('aria-selected') === 'true')
    expect(buttons()[selected]?.getAttribute('data-tab-id')).toBe('c')   // skips the disabled b

    app.destroy(); host.remove()
  })
})
