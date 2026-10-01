// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * tbody 走 keyed 调和（行复用）。
 *
 * 原来 tbody 是 `createFragment` + 手写 `insertBefore` 循环 —— 每次 effect 重跑整块重建：
 * 实测 2000 行改 1 行创建 **6014** 个元素、节点全部换新（行内焦点与 DOM 状态全丢）。
 * 改用 `insertList` 后同场景只创建 **14** 个元素，行节点被复用。
 *
 * 这里的断言是**节点身份**：一旦退回整块重建，`firstRow` 就会变，测试立刻失败。
 * 同时锁住"复用之后内容仍然是新的" —— 这是复用最容易踩坏的地方（行数据必须经
 * memo 在单元格 effect 内取值，而不是靠 insertList 传给渲染函数的那个 item 代理，
 * 实测后者没能让复用的行更新内容）。
 */
describe('KitDataTable 行复用', () => {
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

  it('只改一行内容时复用行节点，而不是整表重建', async () => {
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

    // 节点身份不变 ⇒ 行被复用（整块重建的话这里会全不等）
    expect(bodyRows().map(row => row)).toEqual(before)
    // 但内容必须是新的
    expect(bodyRows()[0]?.textContent).toContain('CHANGED')
    expect(bodyRows()[0]?.textContent).not.toContain('Ada')
    cleanup()
  })

  it('排序后内容跟着变（复用行不能显示旧数据）', async () => {
    const { bodyRows, cleanup } = await mountTable([
      { id: 1, name: 'Ada', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' },
      { id: 3, name: 'Zoe', role: 'Viewer' }
    ], { sort: { columnId: 'name', direction: 'desc' } })
    await settle()

    expect(bodyRows().map(row => row.textContent)).toEqual(['ZoeViewer', 'LinViewer', 'AdaAdmin'])
    cleanup()
  })

  it('有 rowKey 时按数据身份复用（重排也认得住同一行）', async () => {
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

    // 顺序换了，但 Lin 那一行应是同一个节点（按 rowKey 复用）
    expect(bodyRows()[0]).toBe(linRow)
    expect(bodyRows()[0]?.textContent).toContain('Lin')
    cleanup()
  })
})
