// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitDataTable } from './index'
import type { DataTableColumn, DataTableQuery } from './types'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * A static number `page` is **controlled** semantics: the page stays at that
 * number and doesn't move unless the author adopts the callback.
 *
 * A deep-read report wrote this up as "silent failure: a static number page
 * freezes pagination, showing page 2 while emitting page 1". **After
 * reproducing, I judged it not a bug**: verified that static `page: 2` +
 * `pageSize: 4` + 9 rows renders page 2; clicking "next" emits
 * `{page: 3, pageSize: 4, ...}` (emitting exactly the user's intent) while the
 * render **still stays on page 2** — which is the definition of a controlled
 * component: the component reports intent, the author decides whether to pass
 * the new value back.
 * (Same root as the `sort: null` item: the report's "silent failure" frame
 * mostly doesn't hold for the table.)
 *
 * What was actually missing is **documentation**: the type says
 * `page?: number | Signal<number>` without explaining "a number = controlled
 * fixed page". This pins the contract so nobody later "fixes" it into
 * uncontrolled behavior.
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

describe('KitDataTable controlled page semantics', () => {
  it('static number page: rendering stays on that page and the callback only reports user intent', async () => {
    const { queries, bodyText, next, cleanup } = mountTable({ page: 2 })
    await settle()
    expect(bodyText()).toBe('n5,n6,n7,n8')

    next()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    // The component faithfully reports the user's intent…
    expect(queries).toEqual([{ page: 3, pageSize: 4, sort: null, filters: {} }])
    // …but the display still follows the author-provided page (controlled)
    expect(bodyText()).toBe('n5,n6,n7,n8')
    cleanup()
  })

  it('with a Signal adopted by the callback, paging actually moves', async () => {
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
