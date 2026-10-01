// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 可点击的行必须能用键盘激活。
 *
 * `onRowClick` 存在时行会拿到 `tabIndex=0` 与 `data-clickable`（可 Tab 停靠、也对读屏可见），
 * 但原来**只绑了 click** —— 键盘用户 Tab 到行上按回车/空格什么都不会发生。
 * 空格还必须 preventDefault，否则页面会跟着滚。
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const ROWS: Row[] = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Lin' }]

async function mountTable(extra: Record<string, unknown> = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => KitDataTable({ columns, rows: ROWS, ...extra }) })
  app.mount(host)
  await settle()
  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr')]
  const press = (el: HTMLElement, key: string): boolean =>
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  return { host, rows, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable 行的键盘激活', () => {
  it('回车激活可比行，回调收到当前行', async () => {
    const clicked: Array<[number, string]> = []
    const { rows, press, cleanup } = await mountTable({ onRowClick: (row: Row) => clicked.push([row.id, row.name]) })
    expect(rows()[0]?.getAttribute('tabindex')).toBe('0')

    rows()[1]?.focus()
    press(rows()[1]!, 'Enter')
    await settle()
    expect(clicked).toEqual([[2, 'Lin']])
    cleanup()
  })

  it('空格也能激活，且阻止默认（否则页面会滚）', async () => {
    const clicked: string[] = []
    const { rows, press, cleanup } = await mountTable({ onRowClick: (row: Row) => clicked.push(row.name) })

    rows()[0]?.focus()
    const notCancelled = press(rows()[0]!, ' ')      // preventDefault 生效时返回 false
    await settle()
    expect(clicked).toEqual(['Ada'])
    expect(notCancelled).toBe(false)
    cleanup()
  })

  it('没有 onRowClick 的行不可聚焦（行为不变）', async () => {
    const { rows, cleanup } = await mountTable()
    expect(rows()[0]?.getAttribute('tabindex')).toBeNull()
    expect(rows()[0]?.hasAttribute('data-clickable')).toBe(false)
    cleanup()
  })

  it('键盘激活取的是当前行（行会被复用，闭包里的可能是旧的）', async () => {
    const clicked: string[] = []
    const data = state<Row[]>([{ id: 1, name: 'Ada' }])
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => KitDataTable({ columns, get rows() { return data.value }, onRowClick: (row: Row) => clicked.push(row.name) })
    })
    app.mount(host)
    await settle()

    data.value = [{ id: 1, name: 'CHANGED' }]
    await settle()
    const row = host.querySelector<HTMLElement>('tbody tr')!
    row.focus()
    row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(clicked).toEqual(['CHANGED'])
    app.destroy(); host.remove()
  })
})
