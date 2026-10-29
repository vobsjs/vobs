// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * tbody uses keyed reconciliation (row reuse).
 *
 * tbody used to be a `createFragment` + hand-written `insertBefore` loop —
 * every effect re-run rebuilt the whole block: verified that changing 1 row of
 * 2000 created **6014** elements with every node replaced (in-row focus and
 * DOM state all lost). After switching to `insertList`, the same scenario
 * creates only **14** elements and row nodes are reused.
 *
 * The assertions here are about **node identity**: if the code regresses to
 * whole-block rebuild, `firstRow` changes and the test fails immediately.
 * Also locked: "after reuse the content is still fresh" — the easiest thing
 * to break with reuse (row data must be read inside cell effects via the
 * memo, not from the item proxy insertList hands the render function;
 * verified that the latter didn't make reused rows update their content).
 */
describe('KitDataTable row reuse', () => {
  interface Row { id: number; name: string; role: string }
  const columns: readonly DataTableColumn<Row>[] = [
    { id: 'name', label: 'Name', key: 'name', sortable: true },
    { id: 'role', label: 'Role', key: 'role' }
  ]

  async function mountTable(initial: Array<{ id: number; name: string; role: string }>, extra: Record<string, unknown> = {}) {
    const rows = state(initial)
    const props = { columns, get rows() { return rows.value }, ...extra }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable(props) })
    app.mount(host)
    await settle()
    const bodyRows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr')]
    return { rows, host, bodyRows, cleanup: () => { app.destroy(); host.remove() } }
  }

  it("reuses row nodes when only one row's content changes, instead of rebuilding the whole table", async () => {
    const { rows, bodyRows, cleanup } = await mountTable([
      { id: 1, name: 'Ada', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' },
      { id: 3, name: 'Zoe', role: 'Viewer' }
    ])
    expect(bodyRows()).toHaveLength(3)

    const before = bodyRows().map(row => row)
    rows.value = [
      { id: 1, name: 'CHANGED', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' },
      { id: 3, name: 'Zoe', role: 'Viewer' }
    ]
    await settle()

    // Node identity unchanged ⇒ rows reused (a whole-block rebuild would fail all of these)
    expect(bodyRows().map(row => row)).toEqual(before)
    // But the content must be fresh
    expect(bodyRows()[0]?.textContent).toContain('CHANGED')
    expect(bodyRows()[0]?.textContent).not.toContain('Ada')
    cleanup()
  })

  it('content follows after sorting (reused rows must not show stale data)', async () => {
    const { bodyRows, cleanup } = await mountTable([
      { id: 1, name: 'Ada', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' },
      { id: 3, name: 'Zoe', role: 'Viewer' }
    ], { sort: { columnId: 'name', direction: 'desc' } })
    await settle()

    expect(bodyRows().map(row => row.textContent)).toEqual(['ZoeViewer', 'LinViewer', 'AdaAdmin'])
    cleanup()
  })

  it('with rowKey, reuse follows data identity (the same row is recognized across reorders)', async () => {
    const { rows, bodyRows, cleanup } = await mountTable([
      { id: 1, name: 'Ada', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' }
    ], { rowKey: (row: { id: number }) => row.id })

    const linRow = bodyRows()[1]
    rows.value = [
      { id: 2, name: 'Lin', role: 'Viewer' },
      { id: 1, name: 'Ada', role: 'Admin' }
    ]
    await settle()

    // Order swapped, but Lin's row should be the same node (reused by rowKey)
    expect(bodyRows()[0]).toBe(linRow)
    expect(bodyRows()[0]?.textContent).toContain('Lin')
    cleanup()
  })
})
