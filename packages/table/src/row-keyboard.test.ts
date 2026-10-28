// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Clickable rows must be activatable with the keyboard.
 *
 * When `onRowClick` exists the row gets `tabIndex=0` and `data-clickable`
 * (a Tab stop, also visible to screen readers), but **only click used to be
 * bound** — keyboard users could Tab onto the row and pressing Enter/Space did
 * nothing. Space must also preventDefault, otherwise the page scrolls along.
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

describe('KitDataTable row keyboard activation', () => {
  it('Enter activates a clickable row and the callback receives the current row', async () => {
    const clicked: Array<[number, string]> = []
    const { rows, press, cleanup } = await mountTable({ onRowClick: (row: Row) => clicked.push([row.id, row.name]) })
    expect(rows()[0]?.getAttribute('tabindex')).toBe('0')

    rows()[1]?.focus()
    press(rows()[1]!, 'Enter')
    await settle()
    expect(clicked).toEqual([[2, 'Lin']])
    cleanup()
  })

  it('Space also activates and blocks the default (otherwise the page scrolls)', async () => {
    const clicked: string[] = []
    const { rows, press, cleanup } = await mountTable({ onRowClick: (row: Row) => clicked.push(row.name) })

    rows()[0]?.focus()
    const notCancelled = press(rows()[0]!, ' ')      // returns false when preventDefault took effect
    await settle()
    expect(clicked).toEqual(['Ada'])
    expect(notCancelled).toBe(false)
    cleanup()
  })

  it('rows without onRowClick are not focusable (behavior unchanged)', async () => {
    const { rows, cleanup } = await mountTable()
    expect(rows()[0]?.getAttribute('tabindex')).toBeNull()
    expect(rows()[0]?.hasAttribute('data-clickable')).toBe(false)
    cleanup()
  })

  it('keyboard activation reads the current row (rows get reused; the closure may hold a stale one)', async () => {
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
