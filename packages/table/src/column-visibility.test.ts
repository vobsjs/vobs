// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 列的可见性只影响**显示**，不该改变数据语义。
 *
 * 原来 `resolvePage` 把 `visibleColumns(props)` 传给 `applyFiltersAndSort`：把某个可筛选列隐藏掉，
 * 它的筛选条件就静默不再生效 —— 实测把被筛选的那列隐藏后行数从 2 变回 3，而查询条件里明明还在。
 * 排序同理（按隐藏列排序会被静默忽略）。现在筛选/排序走全部列。
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

describe('KitDataTable 列可见性', () => {
  it('隐藏被筛选的列后，筛选条件仍然生效', async () => {
    const visible = await mountTable({ filters: { name: 'Ad' } })
    expect(visible.bodyRows()).toHaveLength(1)
    expect(visible.bodyRows()[0]?.textContent).toContain('Ada')
    visible.cleanup()

    // 把 name 列隐藏：行数不该变回 2（数据语义与显示无关）
    const hidden = await mountTable({ filters: { name: 'Ad' }, visibleColumnIds: ['role'] })
    expect(hidden.bodyRows()).toHaveLength(1)
    expect(hidden.bodyRows()[0]?.textContent).toContain('Admin')   // 只剩 role 单元格
    hidden.cleanup()
  })

  it('按隐藏列排序时，顺序仍然生效', async () => {
    const { bodyRows, cleanup } = await mountTable({
      sort: { columnId: 'name', direction: 'desc' },
      visibleColumnIds: ['role']
    })
    // 屏幕上看不到 name，但顺序必须按它排（Zoe > Lin > Ada）
    expect(bodyRows().map(row => row.textContent)).toEqual(['Viewer', 'Viewer', 'Admin'])
    cleanup()
  })
})
