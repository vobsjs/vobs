// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { FileTree, type FileTreeItem } from './index'

setRenderer(createDOMRenderer())

/*
 * FileTree keyboard accessibility.
 *
 * Every row used to have `tabIndex = 0` (except disabled ones) — a keyboard user had to Tab
 * **through every row of the entire tree** to reach later content; the standard `role="tree"` /
 * `treeitem` model is **a single Tab stop for the whole tree** with arrow keys moving inside.
 * And it had **no arrow-key handling at all** (the original keydown only handled Enter/Space).
 *
 * This locks in: a single Tab stop, arrow keys move focus and select, disabled items are
 * skipped, Home/End.
 * Focusing/selecting triggers row rebuilds, so yield a microtask before asserting.
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const ITEMS: FileTreeItem[] = [
  { id: 'src', label: 'src', kind: 'folder', children: [{ id: 'main', label: 'main.ts', kind: 'file' }] },
  { id: 'readme', label: 'README.md', kind: 'file' },
  { id: 'lock', label: 'lock.json', kind: 'file', disabled: true }
]

async function mountTree(options: { expanded?: string[]; onSelect?: (id: string) => void } = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(FileTree, {
      items: ITEMS,
      defaultExpanded: options.expanded ?? [],
      onSelect: options.onSelect
    })
  })
  app.mount(host)
  await settle()
  const rowIds = (): string[] => [...host.querySelectorAll<HTMLElement>('[data-file-id]')]
    .map(row => row.getAttribute('data-file-id') ?? '')
  const row = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-file-id="${id}"]`)!
  const tabbable = (): string[] => [...host.querySelectorAll<HTMLElement>('[data-file-id]')]
    .filter(r => r.getAttribute('tabindex') === '0')
    .map(r => r.getAttribute('data-file-id') ?? '')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, rowIds, row, tabbable, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('FileTree keyboard accessibility', () => {
  it('the whole tree has a single Tab stop (used to be one per row)', async () => {
    const { rowIds, tabbable, cleanup } = await mountTree()
    expect(rowIds().length).toBeGreaterThan(1)
    expect(tabbable()).toHaveLength(1)
    cleanup()
  })

  it('arrow keys move focus and select, with focus following', async () => {
    const selected: string[] = []
    const { row, tabbable, press, cleanup } = await mountTree({ onSelect: id => selected.push(id) })

    row('src').focus()
    await settle()
    expect(tabbable()).toEqual(['src'])          // whichever row holds focus becomes the Tab stop

    await press('ArrowDown')
    expect(selected).toEqual(['readme'])
    expect(document.activeElement).toBe(row('readme'))
    expect(tabbable()).toEqual(['readme'])

    await press('ArrowUp')
    expect(document.activeElement).toBe(row('src'))

    cleanup()
  })

  it('skips disabled rows', async () => {
    const { row, press, cleanup } = await mountTree()
    row('readme').focus()
    await settle()
    await press('ArrowDown')
    // lock is disabled: focus must not stop there (nor run past the end of the tree)
    expect(document.activeElement).toBe(row('readme'))
    cleanup()
  })

  it('Home / End jump to the first/last visible row', async () => {
    const { row, press, cleanup } = await mountTree()
    row('readme').focus()
    await settle()
    await press('Home')
    expect(document.activeElement).toBe(row('src'))
    await press('End')
    expect(document.activeElement).toBe(row('readme'))
    cleanup()
  })

  it('Enter/Space still activate a row (the original behavior was not displaced by arrow keys)', async () => {
    const selected: string[] = []
    const { row, cleanup } = await mountTree({ onSelect: id => selected.push(id) })
    row('readme').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(selected).toEqual(['readme'])
    cleanup()
  })
})
