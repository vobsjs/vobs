// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Row context menu (rowMenu): the mechanism lives in the component — contextmenu
 * delegation, `data-row-key` row lookup, fixed overlay, outside-click/Escape
 * close; business vocabulary is injected by the page via the `rowMenu(row)`
 * factory. Depends on `rowKey` (row identity lookup); without a rowKey the
 * mechanism silently stays off.
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const ROWS: Row[] = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Lin' }]

async function mountTable(extra: Record<string, unknown> = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    render: () => KitDataTable({ columns, rows: ROWS, rowKey: (row: Row) => row.id, ...extra })
  })
  app.mount(host)
  await settle()
  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr[data-row-key]')]
  const openMenuAt = async (row: HTMLElement): Promise<boolean> => {
    const cell = row.querySelector('td') ?? row
    return cell.dispatchEvent(new window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 66, clientY: 88
    }))
  }
  const menu = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-data-table__rowmenu')
  return { host, rows, openMenuAt, menu, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable row context menu', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('right-clicking a row opens the menu: correct row lookup, preventDefault works, position follows the mouse', async () => {
    const got: Array<[number, string]> = []
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: (row: Row) => { got.push([row.id, row.name]); return [{ label: 'Edit' }] }
    })

    const prevented = await openMenuAt(rows()[1]!)
    await settle()
    expect(prevented).toBe(false) // dispatchEvent returns false when preventDefault succeeded
    expect(got).toEqual([[2, 'Lin']])
    expect(menu()?.getAttribute('style')).toContain('left: 66px')
    expect(menu()?.getAttribute('style')).toContain('top: 88px')
    cleanup()
  })

  it('entry click: closes the menu first, then runs the injected business action', async () => {
    const ran: string[] = []
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: (row: Row) => [{ label: 'Copy', onRun: () => ran.push(row.name) }]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    menu()!.querySelector<HTMLElement>('.vobs-data-table__rowmenu-item')!.click()
    await settle()
    expect(ran).toEqual(['Ada'])
    expect(menu()).toBeNull()
    cleanup()
  })

  it('danger and sep items render per the contract', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [
        { label: 'Edit' },
        { sep: true },
        { label: 'Archive', danger: true }
      ]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    expect(menu()!.querySelectorAll('.vobs-data-table__rowmenu-item')).toHaveLength(2)
    expect(menu()!.querySelector('.vobs-data-table__rowmenu-item.is-danger')?.textContent).toBe('Archive')
    expect(menu()!.querySelector('.vobs-data-table__rowmenu-sep')).not.toBeNull()
    cleanup()
  })

  it('icon channel: the node renders in a fixed slot before the label', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [{
        label: 'Edit',
        icon: () => {
          const svg = document.createElement('svg')
          return svg
        }
      }]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    const item = menu()!.querySelector('.vobs-data-table__rowmenu-item')!
    const slot = item.querySelector('.vobs-data-table__rowmenu-icon')
    expect(slot).not.toBeNull()
    expect(slot!.querySelector('svg')).not.toBeNull()
    // The icon slot comes before the label text (the text node is the entry's last child)
    expect(item.lastChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(item.lastChild?.textContent).toBe('Edit')
    cleanup()
  })

  it('mousedown outside closes the menu; pressing inside does not close it accidentally', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [{ label: 'Edit' }]
    })
    await openMenuAt(rows()[0]!)
    await settle()
    expect(menu()).not.toBeNull()

    // Press inside the menu → stays open
    menu()!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    await settle()
    expect(menu()).not.toBeNull()

    // Press outside the table → closes
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('Escape closes', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [{ label: 'Edit' }]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('an empty items factory renders no overlay; document listeners are cleared after unmount', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({ rowMenu: () => [] })
    await openMenuAt(rows()[0]!)
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('a table without rowMenu: no default prevention, no overlay, no modifier class', async () => {
    const { rows, openMenuAt, menu, cleanup, host } = await mountTable()
    expect(host.querySelector('.vobs-data-table')!.classList.contains('vobs-data-table--rowmenu')).toBe(false)

    const prevented = await openMenuAt(rows()[0]!)
    await settle()
    expect(prevented).toBe(true) // default behavior not prevented
    expect(menu()).toBeNull()
    cleanup()
  })
})
