// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 越界页收敛。
 *
 * `resolvePaginationState` 与 `resolvePage` 原来都直接用 `query.page`：作者（或内部状态）
 * 传一个超出范围的页码时，`pageCount` 算出来是 2 而 `slice` 是空的 —— 摘要显示 "5/2"、
 * 表格显示 "No data"，一个**假空态**（数据明明有，只是页码越界）。
 * `goToPage` 那边本来就有 clamp，只有"从外面传进来的页"漏了。
 *
 * 只收敛渲染用的页号：emit 出去的 query 仍是作者给的值，对外契约不变。
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

describe('KitDataTable 越界页', () => {
  const rows: Row[] = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]

  it('页码越界时渲染最后一页的行，而不是假空态', async () => {
    const { host, bodyRows, cleanup } = await mountTable(rows, { pageSize: 2, page: 5 })

    // pageSize=2、3 行 → 2 页；越界的第 5 页应落到第 2 页（只剩 1 行）
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]?.textContent).toContain('C')
    expect(host.textContent).not.toContain('No data')
    cleanup()
  })

  it('正常范围内的页码不受影响', async () => {
    const { bodyRows, cleanup } = await mountTable(rows, { pageSize: 2, page: 1 })
    expect(bodyRows().map(row => row.textContent)).toEqual(['A', 'B'])
    cleanup()
  })

  it('数据变少导致当前页越界时会自动收敛', async () => {
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

    // 数据只剩 1 行 → 只剩 1 页，第 3 页必须收敛到第 1 页而不是空表
    data.value = [{ id: 1, name: 'A' }]
    await settle()
    const bodyRows = [...host.querySelectorAll<HTMLElement>('tbody tr')]
    expect(bodyRows).toHaveLength(1)
    expect(bodyRows[0]?.textContent).toContain('A')
    expect(host.textContent).not.toContain('No data')

    app.destroy(); host.remove()
  })
})
