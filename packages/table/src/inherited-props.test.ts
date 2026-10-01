// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn, KitDataTableProps } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * props 袋**继承**自另一个对象时，通用属性通道也要认。
 *
 * kit 的 `createTableProps`（resource-page.ts:64）是 `Object.create(tableProps)` 再补几个自有
 * 属性 —— 作者写在 `tableProps` 里的 id / role / aria- 与 data- 属性全在**原型**上。而这里原来用
 * `Object.keys(props)`（只取自有可枚举键），于是这些属性被**静默丢弃**（实测三者都是 null，
 * 而直接调 KitDataTable 传同一批属性就正常 —— 差别只在自有 vs 继承）。
 *
 * 改成 `for...in` 后走原型链。修在消费侧而不是让 kit 摊平：`loading`/`empty` 是 getter，
 * 摊平会当场求值、把 i18n 兜底文案冻结住。
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

describe('KitDataTable 的属性通道', () => {
  it('自有 props 上的 id / role / aria-* 生效', async () => {
    const { host, cleanup } = await mount({ columns, rows: ROWS, id: 'table-1', role: 'grid', 'aria-label': '用户表' })
    expect(host.querySelector('[role=grid]')).toBeTruthy()
    expect(host.querySelector('#table-1')?.getAttribute('aria-label')).toBe('用户表')
    cleanup()
  })

  it('继承来的 props 上的 id / role / aria-* 也生效（kit 的传法）', async () => {
    // 模拟 createTableProps：原型上放作者属性，自有属性只有组件自己补的那几个
    const base = { id: 'table-2', role: 'grid', 'aria-label': '继承来的标签', tabIndex: 3 }
    const props = Object.create(base) as Record<string, unknown>
    props.columns = columns
    props.rows = ROWS

    const { host, cleanup } = await mount(props as unknown as KitDataTableProps<Row>)
    const table = host.querySelector('[role=grid]')
    expect(table).toBeTruthy()                                   // 原来这里会是 null（被静默丢弃）
    expect(table?.getAttribute('id')).toBe('table-2')
    expect(table?.getAttribute('aria-label')).toBe('继承来的标签')
    expect(table?.getAttribute('tabindex')).toBe('3')
    cleanup()
  })
})
