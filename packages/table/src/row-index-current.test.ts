// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 带 `rowKey` 时行会被 keyed 列表**复用并可能被挪到别处**，而 `item.index` 是创建那一刻的
 * 数字快照。修复前：`column.render(row, index)` 与 `onRowClick(row, index)` 拿到的 index
 * 永远是创建时那个 —— 重排/排序之后渲染出来的序号与回调收到的序号都跟当前顺序不符。
 *
 * 修复：`renderBodyItem` 里按 key 在**当前** rows 中反查位置，并把 `getIndex()` 传进
 * `createRow`；`data-row-key` 仍用创建时的 index（行身份不该跟着位置变）。
 *
 * 判据用**渲染出来的内容**（不是内部字段）：单元格文字就是 index，所以重排后文字必须跟着变。
 */
describe('KitDataTable 带 rowKey 时 index 不得冻结', () => {
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

  it('重排之后 column.render 的 index 跟着当前顺序走', async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1'])

    // 交换两行（带 rowKey → 行节点被复用并移动位置）
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()

    // 修复前：仍然是 ['Ada#0', 'Lin#1']（index 冻结成创建时的值）
    expect(cellTexts()).toEqual(['Lin#0', 'Ada#1'])
    cleanup()
  })

  it('过滤掉首行之后，剩下那行的 index 归零', async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }, { id: 'c', name: 'Zoe' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1', 'Zoe#2'])

    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'c', name: 'Zoe' }]
    await settle()
    // Lin 原来是 #1，现在是第 0 位
    expect(cellTexts()).toEqual(['Lin#0', 'Zoe#1'])
    cleanup()
  })

  it('onRowClick 收到的 index 是当前位置', async () => {
    const clicked: Array<[string, number]> = []
    const { rows, host, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id, onRowClick: (row: Row, index: number) => { clicked.push([row.name, index]) } }
    )
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()

    const firstRow = host.querySelector<HTMLElement>('tbody tr[data-row-key="b"]')
    firstRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // 修复前：Lin 在位置 0，回调却收到创建时的 1
    expect(clicked).toEqual([['Lin', 0]])
    cleanup()
  })

  it('不带 rowKey 时行为不变（位置就是身份）', async () => {
    const { rows, cellTexts, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }]
    )
    expect(cellTexts()).toEqual(['Ada#0', 'Lin#1'])
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()
    // 无 rowKey → 按位置调和，行被重建，index 自然对
    expect(cellTexts()).toEqual(['Lin#0', 'Ada#1'])
    cleanup()
  })

  it('data-row-key 用创建时的值，不随位置改变身份', async () => {
    const { rows, host, cleanup } = await mountTable(
      [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Lin' }],
      { rowKey: (row: Row) => row.id }
    )
    expect(host.querySelector('tbody tr[data-row-key="a"]')).not.toBeNull()
    rows.value = [{ id: 'b', name: 'Lin' }, { id: 'a', name: 'Ada' }]
    await settle()
    // 两个 key 都还在（身份稳定），只是顺序变了
    expect(host.querySelector('tbody tr[data-row-key="a"]')).not.toBeNull()
    expect(host.querySelector('tbody tr[data-row-key="b"]')).not.toBeNull()
    cleanup()
  })
})
