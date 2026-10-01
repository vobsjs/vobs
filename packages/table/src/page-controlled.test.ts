// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn, DataTableQuery } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 静态数字 `page` 是**受控**语义：页码恒为它，作者不采纳回调就不动。
 *
 * 深读报告把这条写成"静默失效：静态数字 page 冻结分页，显示 page2 而 emit 是 page1"。
 * **我复现后判定不是 bug**：实测静态 `page: 2` + `pageSize: 4` + 9 行时渲染第 2 页；
 * 点"下一页"发出 `{page: 3, pageSize: 4, ...}`（发出的完全是用户意图），而渲染**仍停在第 2 页** ——
 * 这正是受控组件的定义：组件报告意图，作者决定是否把新值传回来。
 * （与 `sort: null` 那条同源：报告的"静默失效"框架在 table 上多数不成立。）
 *
 * 真正缺的是**文档**：类型写成 `page?: number | Signal<number>`，却没说明"数字 = 受控固定页"。
 * 这里把契约钉住，免得以后有人把它当 bug"修"成非受控。
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const ROWS: Row[] = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `n${i + 1}` }))

function mountTable(extra: Record<string, unknown>) {
  const queries: DataTableQuery[] = []
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => KitDataTable({ columns, rows: ROWS, pageSize: 4, onQueryChange: q => queries.push(q), ...extra })
  })
  app.mount(host)
  const bodyText = (): string => [...host.querySelectorAll('tbody tr')].map(row => row.textContent).join(',')
  const next = (): HTMLElement | undefined => [...host.querySelectorAll<HTMLElement>('button')]
    .find(button => (button.getAttribute('aria-label') ?? '').includes('Next'))
  return { host, queries, bodyText, next, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable 页码受控语义', () => {
  it('静态数字 page：渲染停在该页，回调只报告用户意图', async () => {
    const { queries, bodyText, next, cleanup } = mountTable({ page: 2 })
    await settle()
    expect(bodyText()).toBe('n5,n6,n7,n8')

    next()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    // 组件把用户意图如实报出去……
    expect(queries).toEqual([{ page: 3, pageSize: 4, sort: null, filters: {} }])
    // ……但显示仍然跟随作者给的 page（受控）
    expect(bodyText()).toBe('n5,n6,n7,n8')
    cleanup()
  })

  it('传 Signal 时作者采纳回调，翻页才真的动', async () => {
    const page = state(2)
    const queries: DataTableQuery[] = []
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => KitDataTable({
        columns, rows: ROWS, pageSize: 4,
        get page() { return page.value },
        onQueryChange: query => { queries.push(query); page.value = query.page }
      })
    })
    app.mount(host)
    await settle()

    const next = [...host.querySelectorAll<HTMLElement>('button')].find(button => (button.getAttribute('aria-label') ?? '').includes('Next'))
    next?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()

    expect(queries).toHaveLength(1)
    expect(page.value).toBe(3)
    expect([...host.querySelectorAll('tbody tr')].map(row => row.textContent).join(',')).toBe('n9')
    app.destroy(); host.remove()
  })
})
