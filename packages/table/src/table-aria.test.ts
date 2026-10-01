// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * role / aria-label 必须落在**真正的 <table>** 上。
 *
 * 作者传的这两项由通用属性通道落到外层 <section>，而读屏在"表格"这一层用的是 <table> 自己的名字
 * —— 外层 section 上的名字只让它变成 region，表格本身仍然无名。
 * 现在同步给 table（外层保持原样，纯加法）。
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

describe('KitDataTable 表格语义属性', () => {
  it('aria-label 同时落在 <table> 上（原来只有外层 section 有）', async () => {
    const { table, section, cleanup } = await mount({ 'aria-label': '用户列表' })
    expect(table()?.getAttribute('aria-label')).toBe('用户列表')
    expect(section()?.getAttribute('aria-label')).toBe('用户列表')   // 外层行为不变
    cleanup()
  })

  it('role 也同步过去', async () => {
    const { table, cleanup } = await mount({ role: 'grid', 'aria-label': '网格' })
    expect(table()?.getAttribute('role')).toBe('grid')
    cleanup()
  })

  it('没传就不加（非回归）', async () => {
    const { table, cleanup } = await mount({})
    expect(table()?.hasAttribute('aria-label')).toBe(false)
    expect(table()?.hasAttribute('role')).toBe(false)
    cleanup()
  })
})
