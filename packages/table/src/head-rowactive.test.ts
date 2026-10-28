// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Two capabilities aimed at selection-column scenarios:
 * - `column.head`: header node/factory (dynamic insertion, reactive to
 *   signals) — e.g. a header select-all checkbox; sortable columns still
 *   render the sort button and head is ignored.
 * - `rowActive`: the row active state data-active, evaluated inside a row
 *   effect — a signal flip updates in place, keyed row reuse doesn't drop
 *   subscriptions (no row rebuild).
 */
interface Row { id: number; name: string }

const ROWS: Row[] = [{ id: 1, name: 'Avery' }, { id: 2, name: 'Blake' }]

describe('KitDataTable head nodes', () => {
  it('non-sortable columns render the head node, which rebuilds reactively after a signal flip', async () => {
    const selected = state(false)
    const columns: readonly DataTableColumn<Row>[] = [
      {
        id: 'sel',
        label: '',
        head: () => {
          const input = document.createElement('input')
          input.type = 'checkbox'
          input.checked = selected.value
          input.addEventListener('change', () => { selected.value = input.checked })
          return input
        },
        render: row => row.name
      },
      { id: 'name', label: 'Name', key: 'name' }
    ]
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable({ columns, rows: ROWS }) })
    app.mount(host)
    await settle()

    const input = host.querySelector('thead input[type="checkbox"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.checked).toBe(false)

    selected.value = true
    await settle()
    // insertDynamic rebuilds the header node: the old reference is dead, re-query and assert the new state
    const rebuilt = host.querySelector('thead input[type="checkbox"]') as HTMLInputElement
    expect(rebuilt).toBeTruthy()
    expect(rebuilt).not.toBe(input)
    expect(rebuilt.checked).toBe(true)
    app.destroy(); host.remove()
  })

  it('sortable columns ignore head (the sort button still renders)', async () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { id: 'name', label: 'Name', key: 'name', sortable: true, head: () => document.createElement('input') }
    ]
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable({ columns, rows: ROWS }) })
    app.mount(host)
    await settle()

    expect(host.querySelector('thead input')).toBeNull()
    expect(host.querySelector('thead .vobs-data-table__sort')).toBeTruthy()
    app.destroy(); host.remove()
  })
})

describe('KitDataTable rowActive state', () => {
  it('marks the current row with data-active, updating in place on signal flips (row nodes not rebuilt)', async () => {
    const currentId = state(1)
    const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => KitDataTable({
        columns,
        rows: ROWS,
        rowKey: row => row.id,
        rowActive: row => row.id === currentId.value
      })
    })
    app.mount(host)
    await settle()

    const activeRow = host.querySelector('tbody tr[data-active="true"]') as HTMLTableRowElement
    expect(activeRow).toBeTruthy()
    expect(activeRow.getAttribute('data-row-key')).toBe('1')

    currentId.value = 2
    await settle()
    const rows = host.querySelectorAll('tbody tr')
    // Row nodes are reused by key (same references); only the attribute updates in place
    expect(host.querySelector('tbody tr[data-active="true"]')).toBe(rows[1])
    expect(rows[0].hasAttribute('data-active')).toBe(false)
    app.destroy(); host.remove()
  })

  it('no data-active when rowActive is not provided', async () => {
    const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable({ columns, rows: ROWS }) })
    app.mount(host)
    await settle()

    expect(host.querySelector('tbody tr[data-active]')).toBeNull()
    app.destroy(); host.remove()
  })
})
