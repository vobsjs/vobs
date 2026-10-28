// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * role / aria-label must land on **the real <table>**.
 *
 * Author-passed values travel through the generic attribute channel onto the
 * outer <section>, while screen readers use the <table>'s own name at the
 * "table" level — a name on the outer section only makes it a region and the
 * table itself stays nameless.
 * They are now synced onto the table (outer element unchanged; purely
 * additive).
 */
interface Row { id: number; name: string }
const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const rows: Row[] = [{ id: 1, name: 'Ada' }]

async function mount(props: Record<string, unknown>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable({ columns, rows, ...props }) })
  app.mount(host)
  await settle()
  const table = (): Element | null => host.querySelector('table')
  const section = (): Element | null => host.querySelector('section')
  return { table, section, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable table semantic attributes', () => {
  it('aria-label also lands on the <table> (previously only the outer section had it)', async () => {
    const { table, section, cleanup } = await mount({ 'aria-label': '用户列表' })
    expect(table()?.getAttribute('aria-label')).toBe('用户列表')
    expect(section()?.getAttribute('aria-label')).toBe('用户列表')   // outer behavior unchanged
    cleanup()
  })

  it('role is synced across too', async () => {
    const { table, cleanup } = await mount({ role: 'grid', 'aria-label': '网格' })
    expect(table()?.getAttribute('role')).toBe('grid')
    cleanup()
  })

  it('nothing added when nothing passed (non-regression)', async () => {
    const { table, cleanup } = await mount({})
    expect(table()?.hasAttribute('aria-label')).toBe(false)
    expect(table()?.hasAttribute('role')).toBe(false)
    cleanup()
  })
})
