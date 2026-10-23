// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 行右键菜单（rowMenu）：机制沉淀在组件内——委托 contextmenu、`data-row-key` 反查行、
 * fixed 弹层、外点/Escape 关闭；业务词汇全部经 `rowMenu(row)` 工厂由页面注入。
 * 依赖 `rowKey`（行身份反查），无 rowKey 时机制静默不启用。
 */
interface Row { id: number; name: string }

const columns: readonly DataTableColumn<Row>[] = [{ id: 'name', label: 'Name', key: 'name' }]
const ROWS: Row[] = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Lin' }]

async function mountTable(extra: Record<string, unknown> = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    render: () => KitDataTable({ columns, rows: ROWS, rowKey: (row: Row) => row.id, ...extra })
  })
  app.mount(host)
  await settle()
  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('tbody tr[data-row-key]')]
  const openMenuAt = async (row: HTMLElement): Promise<boolean> => {
    const cell = row.querySelector('td') ?? row
    return cell.dispatchEvent(new window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 66, clientY: 88
    }))
  }
  const menu = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-data-table__rowmenu')
  return { host, rows, openMenuAt, menu, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitDataTable 行右键菜单', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('右键行打开菜单：反查到正确的行，preventDefault 生效，定位跟随鼠标', async () => {
    const got: Array<[number, string]> = []
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: (row: Row) => { got.push([row.id, row.name]); return [{ label: 'Edit' }] }
    })

    const prevented = await openMenuAt(rows()[1]!)
    await settle()
    expect(prevented).toBe(false) // preventDefault 成功时 dispatchEvent 返回 false
    expect(got).toEqual([[2, 'Lin']])
    expect(menu()?.getAttribute('style')).toContain('left: 66px')
    expect(menu()?.getAttribute('style')).toContain('top: 88px')
    cleanup()
  })

  it('条目点击：先关菜单再跑注入的业务动作', async () => {
    const ran: string[] = []
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: (row: Row) => [{ label: 'Copy', onRun: () => ran.push(row.name) }]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    menu()!.querySelector<HTMLElement>('.vobs-data-table__rowmenu-item')!.click()
    await settle()
    expect(ran).toEqual(['Ada'])
    expect(menu()).toBeNull()
    cleanup()
  })

  it('danger 与 sep 项按契约渲染', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [
        { label: 'Edit' },
        { sep: true },
        { label: 'Archive', danger: true }
      ]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    expect(menu()!.querySelectorAll('.vobs-data-table__rowmenu-item')).toHaveLength(2)
    expect(menu()!.querySelector('.vobs-data-table__rowmenu-item.is-danger')?.textContent).toBe('Archive')
    expect(menu()!.querySelector('.vobs-data-table__rowmenu-sep')).not.toBeNull()
    cleanup()
  })

  it('菜单外 mousedown 关闭；菜单内按下不误关', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [{ label: 'Edit' }]
    })
    await openMenuAt(rows()[0]!)
    await settle()
    expect(menu()).not.toBeNull()

    // 菜单内按下 → 不关
    menu()!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    await settle()
    expect(menu()).not.toBeNull()

    // 表格外按下 → 关
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('Escape 关闭', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({
      rowMenu: () => [{ label: 'Edit' }]
    })
    await openMenuAt(rows()[0]!)
    await settle()

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('空 items 工厂不出弹层；卸载后 document 监听被清', async () => {
    const { rows, openMenuAt, menu, cleanup } = await mountTable({ rowMenu: () => [] })
    await openMenuAt(rows()[0]!)
    await settle()
    expect(menu()).toBeNull()
    cleanup()
  })

  it('没有 rowMenu 的表格：右键不拦默认、不出弹层、不带修饰类', async () => {
    const { rows, openMenuAt, menu, cleanup, host } = await mountTable()
    expect(host.querySelector('.vobs-data-table')!.classList.contains('vobs-data-table--rowmenu')).toBe(false)

    const prevented = await openMenuAt(rows()[0]!)
    await settle()
    expect(prevented).toBe(true) // 未拦截默认行为
    expect(menu()).toBeNull()
    cleanup()
  })
})
