// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 两个面向选择列场景的能力：
 * - `column.head`：表头节点/工厂（动态插入，随信号响应）——表头全选框；
 *   sortable 列仍渲染排序按钮，head 被忽略。
 * - `rowActive`：行激活态 data-active，行 effect 内求值——信号翻转原地更新，
 *   keyed 行复用不丢订阅（不重建行）。
 */
interface Row { id: number; name: string }

const ROWS: Row[] = [{ id: 1, name: 'Avery' }, { id: 2, name: 'Blake' }]

describe('KitDataTable head 表头节点', () => {
  it('非排序列渲染 head 节点，信号翻转后节点响应式重建', async () => {
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
    // insertDynamic 重建表头节点：旧引用失效，重新查询断言新状态
    const rebuilt = host.querySelector('thead input[type="checkbox"]') as HTMLInputElement
    expect(rebuilt).toBeTruthy()
    expect(rebuilt).not.toBe(input)
    expect(rebuilt.checked).toBe(true)
    app.destroy(); host.remove()
  })

  it('sortable 列忽略 head（仍渲染排序按钮）', async () => {
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

describe('KitDataTable rowActive 行激活态', () => {
  it('当前行标记 data-active，信号翻转原地更新（行节点不重建）', async () => {
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
    // 行节点被 keyed 复用（引用不变），仅属性原地更新
    expect(host.querySelector('tbody tr[data-active="true"]')).toBe(rows[1])
    expect(rows[0].hasAttribute('data-active')).toBe(false)
    app.destroy(); host.remove()
  })

  it('未提供 rowActive 时无 data-active', async () => {
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
