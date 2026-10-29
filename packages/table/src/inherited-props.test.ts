// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn, KitDataTableProps } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * When the props bag **inherits** from another object, the generic attribute
 * channel must still recognize it.
 *
 * kit's `createTableProps` (resource-page.ts:64) is `Object.create(tableProps)`
 * plus a few own properties — the id / role / aria- / data- attributes the
 * author wrote in `tableProps` all live on **the prototype**. This used
 * `Object.keys(props)` (own enumerable keys only), so those attributes were
 * **silently dropped** (verified: all three were null, while passing the same
 * attributes to a direct KitDataTable call worked — the only difference being
 * own vs inherited).
 *
 * Switching to `for...in` walks the prototype chain. Fixed on the consumer
 * side rather than having kit flatten: `loading`/`empty` are getters, and
 * flattening evaluates them on the spot, freezing the i18n fallback copy.
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const ROWS: Row[] = [{ id: 1, name: 'Ada' }]

async function mount(props: KitDataTableProps<Row>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable(props) })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable attribute channel', () => {
  it('id / role / aria-* on own props take effect', async () => {
    const { host, cleanup } = await mount({ columns, rows: ROWS, id: 'table-1', role: 'grid', 'aria-label': 'User table' })
    expect(host.querySelector('[role=grid]')).toBeTruthy()
    expect(host.querySelector('#table-1')?.getAttribute('aria-label')).toBe('User table')
    cleanup()
  })

  it("id / role / aria-* on inherited props also take effect (kit's passing style)", async () => {
    // Simulate createTableProps: author attributes on the prototype; own props are only the few the component itself adds
    const base = { id: 'table-2', role: 'grid', 'aria-label': 'inherited label', tabIndex: 3 }
    const props = Object.create(base) as Record<string, unknown>
    props.columns = columns
    props.rows = ROWS

    const { host, cleanup } = await mount(props as unknown as KitDataTableProps<Row>)
    const table = host.querySelector('[role=grid]')
    expect(table).toBeTruthy()                                   // this used to be null (silently dropped)
    expect(table?.getAttribute('id')).toBe('table-2')
    expect(table?.getAttribute('aria-label')).toBe('inherited label')
    expect(table?.getAttribute('tabindex')).toBe('3')
    cleanup()
  })
})
