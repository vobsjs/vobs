// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Grouped header (column.group): the leaf-column model stays flat, the kernel
 * renders a two-row thead — row 1 group labels with colspan, row 2 the usual
 * per-column cells. Contiguity is computed against the **visible** columns,
 * so hiding a leaf shrinks its colspan and hiding a middle column splits the
 * group instead of silently rejoining the remaining leaves.
 */
interface Row { id: number; name: string; amount: number }

const ROWS: Row[] = [
  { id: 1, name: 'Avery', amount: 100 },
  { id: 2, name: 'Blake', amount: 250 }
]

function mount(columns: readonly DataTableColumn<Row>[], visibleColumnIds?: readonly string[]) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => KitDataTable({ columns, rows: ROWS, visibleColumnIds })
  })
  app.mount(host)
  return { host, app }
}

const headerRows = (host: HTMLElement): HTMLTableRowElement[] =>
  [...host.querySelectorAll('thead tr')] as HTMLTableRowElement[]

const groupCells = (row: HTMLTableRowElement): HTMLTableCellElement[] =>
  [...row.querySelectorAll('th[data-column-group]')] as HTMLTableCellElement[]

describe('KitDataTable grouped header', () => {
  it('renders two header rows: group label with colspan above its leaf columns', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'name', label: '客户' },
      { id: 'vatAmount', label: '金额', group: { id: 'vat', label: '增值税' } },
      { id: 'vatStatus', label: '状态', group: { id: 'vat', label: '增值税' } }
    ]
    const { host, app } = mount(columns)
    await settle()

    const rows = headerRows(host)
    expect(rows).toHaveLength(2)

    const group = groupCells(rows[0])[0]
    expect(group.colSpan).toBe(2)
    expect(group.getAttribute('scope')).toBe('colgroup')
    expect(group.textContent).toBe('增值税')

    // Ungrouped column spans both rows so the header stays rectangular
    const nameCell = rows[0].querySelector('th[data-column-id="name"]') as HTMLTableCellElement
    expect(nameCell.rowSpan).toBe(2)
    expect(nameCell.getAttribute('scope')).toBe('col')

    // Leaf row keeps one cell per leaf column
    const leafIds = [...rows[1].querySelectorAll('th')].map(cell => cell.getAttribute('data-column-id'))
    expect(leafIds).toEqual(['vatAmount', 'vatStatus'])

    app.destroy(); host.remove()
  })

  it('keeps a single header row when no column declares a group', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'name', label: '客户' },
      { id: 'amount', label: '金额' }
    ]
    const { host, app } = mount(columns)
    await settle()

    expect(headerRows(host)).toHaveLength(1)
    expect(host.querySelector('thead')?.getAttribute('data-grouped-head')).toBeNull()
    expect(host.querySelector('th[data-column-group]')).toBeNull()

    app.destroy(); host.remove()
  })

  it('colspan follows visibility: hiding a leaf shrinks the group cell', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'name', label: '客户' },
      { id: 'vatAmount', label: '金额', group: { id: 'vat', label: '增值税' } },
      { id: 'vatStatus', label: '状态', group: { id: 'vat', label: '增值税' } }
    ]
    const { host, app } = mount(columns, ['name', 'vatAmount'])
    await settle()

    const group = groupCells(headerRows(host)[0])[0]
    expect(group.colSpan).toBe(1)
    expect(headerRows(host)[1].querySelectorAll('th')).toHaveLength(1)

    app.destroy(); host.remove()
  })

  it('splits a group when a middle column hides it (labels repeat, never silently rejoined)', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'a', label: 'A', group: { id: 'g', label: 'G' } },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C', group: { id: 'g', label: 'G' } }
    ]
    const { host, app } = mount(columns)
    await settle()

    // Visible order is a, b, c → two separate group runs around the ungrouped column
    const groups = groupCells(headerRows(host)[0])
    expect(groups).toHaveLength(2)
    expect(groups.map(cell => cell.colSpan)).toEqual([1, 1])
    expect(groups.map(cell => cell.textContent)).toEqual(['G', 'G'])

    app.destroy(); host.remove()
  })

  it('keeps sort buttons on leaf cells inside a group', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'vatAmount', label: '金额', sortable: true, group: { id: 'vat', label: '增值税' } },
      { id: 'vatStatus', label: '状态', group: { id: 'vat', label: '增值税' } }
    ]
    const { host, app } = mount(columns)
    await settle()

    const leafRow = headerRows(host)[1]
    expect(leafRow.querySelector('th[data-column-id="vatAmount"] .vobs-data-table__sort')).toBeTruthy()
    // Sorted header stays in the leaf row, the group row keeps a plain label
    expect(groupCells(headerRows(host)[0])[0].querySelector('.vobs-data-table__sort')).toBeNull()
    expect(groupCells(headerRows(host)[0])[0].textContent).toBe('增值税')

    app.destroy(); host.remove()
  })

  it('supports a reactive factory group label', async () => {
    const label = state('增值税')
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'vatAmount', label: '金额', group: { id: 'vat', label: () => label.value } },
      { id: 'vatStatus', label: '状态', group: { id: 'vat', label: () => label.value } }
    ]
    const { host, app } = mount(columns)
    await settle()
    expect(groupCells(headerRows(host)[0])[0].textContent).toBe('增值税')

    label.value = '增值税（含预缴）'
    await settle()
    expect(groupCells(headerRows(host)[0])[0].textContent).toBe('增值税（含预缴）')

    app.destroy(); host.remove()
  })

  it('falls back to the group id when no label is provided', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'a', label: 'A', group: { id: 'g1' } },
      { id: 'b', label: 'B', group: { id: 'g1' } }
    ]
    const { host, app } = mount(columns)
    await settle()
    expect(groupCells(headerRows(host)[0])[0].textContent).toBe('g1')

    app.destroy(); host.remove()
  })
})
