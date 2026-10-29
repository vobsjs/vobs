// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { EditorTabs, type EditorTabItem } from './index'

setRenderer(createDOMRenderer())

/*
 * EditorTabs accessibility.
 *
 * The rows used to carry `role="tab"` while the container had **no role at all** — screen readers
 * couldn't find the tablist these tabs belong to; and arrow keys **only changed the selection
 * without moving focus**: focus stayed on the old row, whose tabindex had already become -1 due
 * to the selection change, splitting DOM focus from aria-selected — the keyboard user's next
 * step still started from the old position.
 *
 * Focus needs the update to land (selection triggers a rebuild of the tab row), so yield a
 * microtask before asserting.
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const TABS: EditorTabItem[] = ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() }))

async function mountEditorTabs(changes: string[] = []) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(EditorTabs, { tabs: TABS, onChange: (id: string) => changes.push(id) })
  })
  app.mount(host)
  await settle()
  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
  const selectedIndex = (): number => rows().findIndex(r => r.getAttribute('aria-selected') === 'true')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, rows, selectedIndex, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('EditorTabs accessibility', () => {
  it('container has role=tablist (rows used to carry role=tab with nothing to belong to)', async () => {
    const { host, cleanup } = await mountEditorTabs()
    expect(host.querySelector('[role=tablist]')).toBeTruthy()
    cleanup()
  })

  it('arrow keys change the selection and move focus to the new row', async () => {
    const changes: string[] = []
    const { rows, selectedIndex, press, cleanup } = await mountEditorTabs(changes)

    expect(rows().map(r => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    rows()[0].focus()

    await press('ArrowRight')
    expect(selectedIndex()).toBe(1)
    expect(changes).toEqual(['b'])
    expect(rows().map(r => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(document.activeElement).toBe(rows()[1])   // focus used to stay on the old row

    cleanup()
  })

  it('repeated arrow presses continue from the new current position each time', async () => {
    const { rows, selectedIndex, press, cleanup } = await mountEditorTabs()

    rows()[0].focus()
    await press('ArrowRight')
    await press('ArrowRight')
    expect(selectedIndex()).toBe(2)
    expect(document.activeElement).toBe(rows()[2])

    await press('ArrowLeft')
    expect(selectedIndex()).toBe(1)
    expect(document.activeElement).toBe(rows()[1])

    cleanup()
  })

  it('quotes in a tab id do not break keyboard handling (no selector concatenation)', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const tricky: EditorTabItem[] = [
      { id: 'a"b', label: 'A' },
      { id: 'c', label: 'C' }
    ]
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(EditorTabs, { tabs: tricky }) })
    app.mount(host)
    await settle()

    const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
    rows()[0].focus()
    rows()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await settle()
    expect(document.activeElement).toBe(rows()[1])

    app.destroy(); host.remove()
  })
})
