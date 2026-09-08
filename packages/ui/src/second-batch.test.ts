import { beforeEach, describe, expect, it } from 'vitest'
import { state } from '@vobs/reactivity'
import {
  createComponent,
  createDOMRenderer,
  createElement,
  createVobs,
  insertBefore,
  setRenderer
} from '@vobs/vobs'
import { Avatar } from './avatar'
import { Kbd, KbdCombo, KbdRow } from './kbd'
import { Menu } from './menu'
import { NavList, type NavGroup } from './nav-list'
import { PageHeader, PageHeaderAction } from './page-header'
import { Pagination } from './pagination'
import { StatCard, StatCardGrid } from './stat-card'
import { Table, TablePanel, type TableColumn } from './table'

describe('@vobs/ui second batch', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('Menu renders icons, shortcuts, dividers and select callbacks', () => {
    const selected: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Menu, {
        items: [
          { id: 'edit', label: 'Edit', shortcut: 'Ctrl+E' },
          { id: 'separator', divider: true },
          { id: 'delete', label: 'Delete', danger: true, disabled: true }
        ],
        onSelect: id => selected.push(id)
      })
    })
    app.mount(container)

    expect(container.querySelector('.vui-menu')).toBeTruthy()
    expect(container.querySelector('.vui-menu__shortcut')?.textContent).toBe('Ctrl+E')
    expect(container.querySelector('.vui-menu__divider')).toBeTruthy()
    ;(container.querySelector('[data-menu-item-id="edit"]') as HTMLElement).click()
    ;(container.querySelector('[data-menu-item-id="delete"]') as HTMLElement).click()
    expect(selected).toEqual(['edit'])
    app.destroy()
  })

  it('NavList uses controlled Signal state and native links/buttons', () => {
    const active = state('home')
    const groups: readonly NavGroup[] = [{
      title: 'Workspace',
      items: [
        { id: 'home', label: 'Home' },
        { id: 'settings', label: 'Settings', href: '/settings' }
      ]
    }]
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(NavList, {
        groups,
        get value() { return active.value },
        onChange: id => { active.value = id }
      })
    })
    app.mount(container)

    expect(container.querySelector('[data-nav-id="home"]')?.classList.contains('is-active')).toBe(true)
    ;(container.querySelector('[data-nav-id="settings"]') as HTMLElement).click()
    app.update()
    expect(active.value).toBe('settings')
    expect(container.querySelector('[data-nav-id="settings"]')?.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('a[href="/settings"]')).toBeTruthy()
    app.destroy()
  })

  it('Pagination builds condensed pages and reports page changes', () => {
    const page = state(5)
    const changes: number[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Pagination, {
        get page() { return page.value },
        pageCount: 20,
        onChange: next => {
          changes.push(next)
          page.value = next
        }
      })
    })
    app.mount(container)

    expect(container.querySelectorAll('.vui-pagination__item').length).toBe(9)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('5')
    const next = container.querySelector('[aria-label="Next"]') as HTMLButtonElement
    next.click()
    app.update()
    expect(changes).toEqual([6])
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('6')
    app.destroy()
  })

  it('Avatar, PageHeader, StatCard and Kbd expose UIStyle structure', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertBefore(root, createComponent(Avatar, { fallback: 'A', size: 'lg', shape: 'square' }), null)
        insertBefore(root, createComponent(PageHeader, {
            title: 'Members',
            subtitle: 'Manage access',
            actions: createComponent(PageHeaderAction, { primary: true, children: 'Invite' })
          }), null)
        insertBefore(root, createComponent(StatCardGrid, {
            children: createComponent(StatCard, {
              label: 'Users',
              value: '24',
              delta: '+12%',
              deltaDirection: 'up',
              deltaCaption: 'this month'
            })
          }), null)
        insertBefore(root, createComponent(KbdRow, {
            children: [
              createComponent(Kbd, { children: 'Esc' }),
              createComponent(KbdCombo, { keys: ['Ctrl', 'K'] })
            ]
          }), null)
        return root
      }
    })
    app.mount(container)

    expect(container.querySelector('.vui-avatar--lg.vui-avatar--square')?.textContent).toBe('A')
    expect(container.querySelector('.vui-pagehead__title')?.textContent).toBe('Members')
    expect(container.querySelector('.vui-pagehead__btn.is-primary')?.textContent).toBe('Invite')
    expect(container.querySelector('.vui-statcard__value')?.textContent).toBe('24')
    expect(container.querySelector('.vui-statcard__delta.is-up')?.textContent).toContain('+12%')
    expect(container.querySelectorAll('.vui-kbd').length).toBe(3)
    app.destroy()
  })

  it('Avatar 图片样式和 Table 居中对齐不使用内联样式', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertBefore(root, createComponent(Avatar, { src: '/avatar.png', alt: 'Avery' }), null)
        insertBefore(root, createComponent(Table, {
          columns: [
            { id: 'name', label: 'Member', key: 'name', align: 'center' }
          ],
          rows: [{ name: 'Avery' }]
        }), null)
        return root
      }
    })
    app.mount(container)

    expect(container.querySelector('.vui-avatar__image')?.hasAttribute('style')).toBe(false)
    const centeredCell = container.querySelector('[data-align="center"]') as HTMLElement
    expect(centeredCell).toBeTruthy()
    expect(centeredCell.hasAttribute('style')).toBe(false)
    app.destroy()
  })

  it('Table renders columns, keyed row metadata, empty state and panel footer', () => {
    interface Member { id: number; name: string; status: string }
    const columns: readonly TableColumn<Member>[] = [
      { id: 'name', label: 'Member', key: 'name' },
      { id: 'status', label: 'Status', render: row => row.status, align: 'center' },
      { id: 'count', label: 'Count', render: () => '1', align: 'end' }
    ]
    const rows: readonly Member[] = [{ id: 1, name: 'Avery', status: 'Active' }]
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(TablePanel, {
        columns,
        rows,
        rowKey: row => row.id,
        footer: 'Showing 1 member'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vui-tablepanel')).toBeTruthy()
    expect(container.querySelectorAll('.vui-table th').length).toBe(3)
    expect(container.querySelector('[data-row-key="1"]')?.textContent).toContain('Avery')
    expect(container.querySelector('.vui-table td.num')?.textContent).toBe('1')
    expect(container.querySelector('.vui-tablepanel__foot')?.textContent).toBe('Showing 1 member')
    app.destroy()

    const emptyContainer = document.createElement('main')
    const emptyApp = createVobs({
      render: () => createComponent(Table, {
        columns: [{ id: 'name', label: 'Member' }],
        rows: [],
        empty: 'Nothing here'
      })
    })
    emptyApp.mount(emptyContainer)
    expect(emptyContainer.querySelector('tbody')?.textContent).toContain('Nothing here')
    emptyApp.destroy()
  })
})
