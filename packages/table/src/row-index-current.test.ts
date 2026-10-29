// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * With `rowKey`, rows get **reused by the keyed list and may be moved
 * elsewhere**, while `item.index` is the numeric snapshot from creation time.
 * Before the fix: the index received by `column.render(row, index)` and
 * `onRowClick(row, index)` was always the creation-time one — after
 * reorder/sort, the rendered ordinals and the ordinals delivered to callbacks
 * no longer matched the current order.
 *
 * Fix: `renderBodyItem` looks the position up by key in the **current** rows
 * and passes `getIndex()` into `createRow`; `data-row-key` still uses the
 * creation-time index (row identity must not follow position).
 *
 * The criterion uses **rendered content** (not internal fields): the cell text
 * is the index, so after a reorder the text must follow.
 */
describe('KitDataTable index must not freeze when rowKey is used', () => {
  interface Row { id: string; name: string }
  const columns: readonly DataTableColumn<Row>[] = [
    {
      id: 'ordinal',
      label: '#',
      render: (row: Row, index: number) => `${row.name}#${index}`
    }
  ]

  async function mountTable(initial: Row[], extra: Record<string, unknown> = {}) {
    const rows = state(initial)
    const props = { columns, get rows() { return rows.value }, ...extra }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable(props) })
    app.mount(host)
    await settle()
    const cellTexts = (): string[] =>
      [...host.querySelectorAll<HTMLElement>('tbody tr td[data-column-id="ordinal"]')].map(td => td.textContent ?? '')
    return { rows, host, cellTexts, cleanup: () => { app.destroy(); host.remove() } }
  }

  it("column.render's index follows the current order after a reorder", async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1'])

    // Swap the two rows (with rowKey → row nodes are reused and moved)
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()

    // Before the fix: still ['Ada#0', 'Lin#1'] (index frozen at creation time)
    expect(cellTexts()).toEqual(['Lin#0', 'Ada#1'])
    cleanup()
  })

  it("after filtering out the first row, the remaining row's index becomes 0", async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }, { id: 'c', name: 'Zoe' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1', 'Zoe#2'])

    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'c', name: 'Zoe' }]
    await settle()
    // Lin used to be #1, now at position 0
    expect(cellTexts()).toEqual(['Lin#0', 'Zoe#1'])
    cleanup()
  })

  it('onRowClick receives the index of the current position', async () => {
    const clicked: Array<[string, number]> = []
    const { rows, host, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id, onRowClick: (row: Row, index: number) => { clicked.push([row.name, index]) } }
    )
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()

    const firstRow = host.querySelector<HTMLElement>('tbody tr[data-row-key="b"]')
    firstRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Before the fix: Lin was at position 0 but the callback received the creation-time 1
    expect(clicked).toEqual([['Lin', 0]])
    cleanup()
  })

  it('without rowKey the behavior is unchanged (position is identity)', async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }]
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1'])
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()
    // No rowKey → positional reconciliation rebuilds rows, so the index is naturally correct
    expect(cellTexts()).toEqual(['Lin#0', 'Ada#1'])
    cleanup()
  })

  it('data-row-key keeps the creation-time value; identity does not change with position', async () => {
    const { rows, host, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(host.querySelector('tbody tr[data-row-key="a"]')).not.toBeNull()
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()
    // Both keys are still present (identity stable); only the order changed
    expect(host.querySelector('tbody tr[data-row-key="a"]')).not.toBeNull()
    expect(host.querySelector('tbody tr[data-row-key="b"]')).not.toBeNull()
    cleanup()
  })
})
