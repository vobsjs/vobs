// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Out-of-range page clamping.
 *
 * `resolvePaginationState` and `resolvePage` both used `query.page` directly:
 * when the author (or internal state) passed an out-of-range page, `pageCount`
 * computed to 2 while the `slice` was empty — the summary showed "5/2" and the
 * table showed "No data": a **fake empty state** (data exists; the page number
 * is just out of range). `goToPage` already clamped; only "pages passed in
 * from the outside" leaked.
 *
 * Only the page number used for rendering is clamped: the emitted query keeps
 * the author's value and the external contract is unchanged.
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]

async function mountTable(rows: Row[], extra: Record<string, unknown> = {}) {
  const data = state(rows)
  const props = { columns, get rows() { return data.value }, ...extra }
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable(props) })
  app.mount(host)
  await settle()
  return {
    host,
    bodyRows: (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr')],
    cleanup: () => { app.destroy(); host.remove() }
  }
}

describe('KitDataTable out-of-range pages', () => {
  const rows: Row[] = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]

  it("renders the last page's rows when the page number is out of range, instead of a fake empty state", async () => {
    const { host, bodyRows, cleanup } = await mountTable(rows, { pageSize: 2, page: 5 })

    // pageSize=2 with 3 rows → 2 pages; the out-of-range page 5 should land on page 2 (1 row left)
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]?.textContent).toContain('C')
    expect(host.textContent).not.toContain('No data')
    cleanup()
  })

  it('page numbers within range are unaffected', async () => {
    const { bodyRows, cleanup } = await mountTable(rows, { pageSize: 2, page: 1 })
    expect(bodyRows().map(row => row.textContent)).toEqual(['A', 'B'])
    cleanup()
  })

  it('clamps automatically when shrinking data pushes the current page out of range', async () => {
    const data = state<Row[]>([{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }])
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => KitDataTable({ columns, get rows() { return data.value }, pageSize: 1, page: 3 })
    })
    app.mount(host)
    await settle()
    expect(host.querySelectorAll('tbody tr')[0]?.textContent).toContain('C')

    // Only 1 row left → only 1 page; page 3 must clamp to page 1 rather than an empty table
    data.value = [{ id: 1, name: 'A' }]
    await settle()
    const bodyRows = [...host.querySelectorAll<HTMLElement>('tbody tr')]
    expect(bodyRows).toHaveLength(1)
    expect(bodyRows[0]?.textContent).toContain('A')
    expect(host.textContent).not.toContain('No data')

    app.destroy(); host.remove()
  })
})
