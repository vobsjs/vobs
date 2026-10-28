// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Column visibility only affects **display** and must not change data
 * semantics.
 *
 * `resolvePage` used to pass `visibleColumns(props)` to `applyFiltersAndSort`:
 * hiding a filterable column silently stopped its filter from applying —
 * verified that hiding the filtered column took the row count from 2 back to 3
 * while the query condition was still right there. Same for sorting (sorting
 * by a hidden column was silently ignored). Filter/sort now run over all
 * columns.
 */
interface Row { id: number; name: string; role: string }

const columns: readonly DataTableColumn<Row>[] = [
  { id: 'name', label: 'Name', key: 'name' },
  { id: 'role', label: 'Role', key: 'role' }
]

const ROWS: Row[] = [
  { id: 1, name: 'Ada', role: 'Admin' },
  { id: 2, name: 'Lin', role: 'Viewer' },
  { id: 3, name: 'Zoe', role: 'Viewer' }
]

async function mountTable(extra: Record<string, unknown> = {}) {
  const data = state(ROWS)
  const props = { columns, get rows() { return data.value }, ...extra }
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable(props) })
  app.mount(host)
  await settle()
  const bodyRows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr')]
  return { host, bodyRows, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable column visibility', () => {
  it('the filter still applies after hiding the filtered column', async () => {
    const visible = await mountTable({ filters: { name: 'Ad' } })
    expect(visible.bodyRows()).toHaveLength(1)
    expect(visible.bodyRows()[0]?.textContent).toContain('Ada')
    visible.cleanup()

    // Hide the name column: the row count must not go back to 2 (data semantics are independent of display)
    const hidden = await mountTable({ filters: { name: 'Ad' }, visibleColumnIds: ['role'] })
    expect(hidden.bodyRows()).toHaveLength(1)
    expect(hidden.bodyRows()[0]?.textContent).toContain('Admin')   // only the role cell remains
    hidden.cleanup()
  })

  it('sorting by a hidden column still takes effect', async () => {
    const { bodyRows, cleanup } = await mountTable({
      sort: { columnId: 'name', direction: 'desc' },
      visibleColumnIds: ['role']
    })
    // name is invisible on screen, but the order must follow it (Zoe > Lin > Ada)
    expect(bodyRows().map(row => row.textContent)).toEqual(['Viewer', 'Viewer', 'Admin'])
    cleanup()
  })
})
