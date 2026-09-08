import { beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@vobs/reactivity'
import { addEventListener, createDOMRenderer, createElement, createVobs, setAttribute, setRenderer } from '@vobs/vobs'
import {
  createColumnSettingsPersistence,
  createLocalColumnSettingsPersistence,
  KitColumnSettings,
  KitDataTable
} from './index'
import type {
  DataTableColumn,
  DataTableColumnSettings,
  DataTableColumnSettingsPersistence,
  DataTableColumnSettingsStorage,
  DataTableQuery
} from './types'

interface User { id: number; name: string; role: string }

const columns: readonly DataTableColumn<User>[] = [
  { id: 'name', label: 'Name', key: 'name', sortable: true, filterable: true },
  { id: 'role', label: 'Role', key: 'role', sortable: true }
]

describe('@vobs/table', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('支持客户端筛选、排序和分页，并通过 query 回调交给宿主控制', () => {
    const container = document.createElement('div')
    const queries: DataTableQuery[] = []
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [
          { id: 1, name: 'Ada', role: 'Admin' },
          { id: 2, name: 'Lin', role: 'Viewer' }
        ],
        pageSize: 1,
        sort: null,
        onQueryChange: query => queries.push(query)
      })
    })
    app.mount(container)

    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelector('.vobs-data-table__filters')).toBeNull()
    expect(container.querySelector('.vobs-data-table__filter')).toBeNull()
    expect(container.textContent).toContain('Ada')
    ;(container.querySelector('button.vobs-data-table__sort') as HTMLButtonElement).click()
    expect(queries[0]?.sort).toEqual({ columnId: 'name', direction: 'asc' })
    ;(container.querySelector('.vobs-data-table__page-button:not([disabled])') as HTMLButtonElement).click()
    expect(queries[1]?.page).toBe(2)
    app.destroy()
  })

  it('客户端排序会实际改变行顺序，并支持升序、降序和取消排序', async () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [
          { id: 1, name: 'Zoe', role: 'Admin' },
          { id: 2, name: 'Ada', role: 'Viewer' },
          { id: 3, name: 'Lin', role: 'Editor' }
        ]
      })
    })
    app.mount(container)

    const names = (): string[] => [...container.querySelectorAll('td[data-column-id="name"]')]
      .map(cell => cell.textContent ?? '')
    const sortButton = container.querySelector('button.vobs-data-table__sort') as HTMLButtonElement
    const header = container.querySelector('th[data-column-id="name"]') as HTMLTableCellElement

    expect(names()).toEqual(['Zoe', 'Ada', 'Lin'])
    sortButton.click()
    await Promise.resolve()
    expect(names()).toEqual(['Ada', 'Lin', 'Zoe'])
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(header.getAttribute('data-sort-direction')).toBe('asc')

    sortButton.click()
    await Promise.resolve()
    expect(names()).toEqual(['Zoe', 'Lin', 'Ada'])
    expect(header.getAttribute('aria-sort')).toBe('descending')

    sortButton.click()
    await Promise.resolve()
    expect(names()).toEqual(['Zoe', 'Ada', 'Lin'])
    expect(header.hasAttribute('aria-sort')).toBe(false)
    expect(header.hasAttribute('data-sort-direction')).toBe(false)
    app.destroy()
  })

  it('客户端排序支持数字、日期、空值置后和自定义 sortValue', async () => {
    interface Metric {
      readonly id: number
      readonly score: number | null
      readonly createdAt: string
    }
    const metricColumns: readonly DataTableColumn<Metric>[] = [
      { id: 'score', label: 'Score', key: 'score', sortable: true, sortType: 'number', sortValue: row => row.score },
      { id: 'createdAt', label: 'Created', sortable: true, sortType: 'date', key: 'createdAt' }
    ]
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<Metric>({
        columns: metricColumns,
        rows: [
          { id: 1, score: 10, createdAt: '2026-01-02' },
          { id: 2, score: null, createdAt: '2025-12-01' },
          { id: 3, score: 2, createdAt: '2026-01-01' }
        ]
      })
    })
    app.mount(container)

    const scores = (): string[] => [...container.querySelectorAll('td[data-column-id="score"]')]
      .map(cell => cell.textContent ?? '')
    const scoreButton = container.querySelector('th[data-column-id="score"] button') as HTMLButtonElement
    scoreButton.click()
    await Promise.resolve()
    expect(scores()).toEqual(['2', '10', ''])
    scoreButton.click()
    await Promise.resolve()
    expect(scores()).toEqual(['10', '2', ''])

    const dates = (): string[] => [...container.querySelectorAll('td[data-column-id="createdAt"]')]
      .map(cell => cell.textContent ?? '')
    const dateButton = container.querySelector('th[data-column-id="createdAt"] button') as HTMLButtonElement
    dateButton.click()
    await Promise.resolve()
    expect(dates()).toEqual(['2025-12-01', '2026-01-01', '2026-01-02'])
    dateButton.click()
    await Promise.resolve()
    expect(dates()).toEqual(['2026-01-02', '2026-01-01', '2025-12-01'])
    app.destroy()
  })

  it('服务端排序模式只发出 sort 查询，不重排当前页数据', () => {
    const queries: DataTableQuery[] = []
    const serverColumns: readonly DataTableColumn<User>[] = [
      { id: 'name', label: 'Name', key: 'name', sortable: true, sortKey: 'display_name' },
      { id: 'role', label: 'Role', key: 'role' }
    ]
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns: serverColumns,
        rows: [
          { id: 1, name: 'Zoe', role: 'Admin' },
          { id: 2, name: 'Ada', role: 'Viewer' }
        ],
        total: 20,
        sortingMode: 'server',
        onQueryChange: query => queries.push(query)
      })
    })
    app.mount(container)

    const names = (): string[] => [...container.querySelectorAll('td[data-column-id="name"]')]
      .map(cell => cell.textContent ?? '')
    ;(container.querySelector('button.vobs-data-table__sort') as HTMLButtonElement).click()

    expect(names()).toEqual(['Zoe', 'Ada'])
    expect(queries[0]?.sort).toEqual({ columnId: 'name', direction: 'asc', sortKey: 'display_name' })
    app.destroy()
  })

  it('接受外部 filters 和列 filter 谓词，但不渲染表格内筛选输入', () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        rows: [
          { id: 1, name: 'Ada', role: 'Admin' },
          { id: 2, name: 'Lin', role: 'Viewer' }
        ],
        filters: { name: 'Ad' },
        columns: columns.map(column => column.id === 'name'
          ? { ...column, filter: (row, value) => row.name.includes(String(value)) }
          : column)
      })
    })
    app.mount(container)
    expect(container.querySelector('.vobs-data-table__filter')).toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(container.querySelector('tbody')?.textContent).toContain('Ada')
    expect(container.querySelector('tbody')?.textContent).not.toContain('Lin')
    app.destroy()
  })

  it('默认固定表头，并允许关闭固定表头', () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [{ id: 1, name: 'Ada', role: 'Admin' }]
      })
    })
    app.mount(container)
    expect(container.querySelector('.vobs-data-table')?.classList.contains('vobs-data-table--sticky-header')).toBe(true)
    app.destroy()

    const disabledContainer = document.createElement('div')
    const disabledApp = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [{ id: 1, name: 'Ada', role: 'Admin' }],
        stickyHeader: false
      })
    })
    disabledApp.mount(disabledContainer)
    expect(disabledContainer.querySelector('.vobs-data-table')?.classList.contains('vobs-data-table--sticky-header')).toBe(false)
    disabledApp.destroy()
  })

  it('使用列设置应用列显隐、顺序和宽度', () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [{ id: 1, name: 'Ada', role: 'Admin' }],
        columnSettings: {
          visibleColumnIds: ['role', 'name'],
          columnOrder: ['role', 'name'],
          columnWidths: { name: 160 }
        }
      })
    })
    app.mount(container)

    expect([...container.querySelectorAll('thead th')].map(cell => cell.getAttribute('data-column-id')))
      .toEqual(['role', 'name'])
    expect(container.querySelector('thead th[data-column-id="name"]')?.getAttribute('style'))
      .toContain('width: 160px')
    expect(container.querySelector('tbody td[data-column-id="name"]')?.getAttribute('style'))
      .toContain('width: 160px')
    app.destroy()
  })

  it('使用紧凑摘要显示当前显示数、每页数、当前页和总页数', () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [
          { id: 1, name: 'Ada', role: 'Admin' },
          { id: 2, name: 'Lin', role: 'Viewer' },
          { id: 3, name: 'Grace', role: 'Reviewer' },
          { id: 4, name: 'Margaret', role: 'Maintainer' },
          { id: 5, name: 'Alan', role: 'Contributor' }
        ],
        total: 15,
        pageSize: 10
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-data-table__summary')?.textContent).toBe('5/10 - 1/2')
    app.destroy()
  })

  it('按 simple、standard、all 逐步增加页码和跳转控件', () => {
    const renderTable = (paginationMode: 'simple' | 'standard' | 'all') => KitDataTable<User>({
      columns,
      rows: Array.from({ length: 8 }, (_, id) => ({ id, name: `User ${id}`, role: 'Viewer' })),
      pageSize: 1,
      paginationMode
    })

    for (const [mode, expectedPageButtons, expectedNumberButtons, expectsJump] of [
      ['simple', 2, 0, false],
      ['standard', 2, 3, false],
      ['all', 2, 3, true]
    ] as const) {
      const container = document.createElement('div')
      const app = createVobs({ render: () => renderTable(mode) })
      app.mount(container)

      expect(container.querySelectorAll('.vobs-data-table__pagination > .vobs-data-table__page-button')).toHaveLength(expectedPageButtons)
      expect(container.querySelectorAll('.vobs-data-table__pagination-pages .vobs-data-table__page-button')).toHaveLength(expectedNumberButtons)
      expect(container.querySelector('.vobs-data-table__pagination-jump') !== null).toBe(expectsJump)
      expect(container.querySelector('.vobs-data-table__page-size-select')).not.toBeNull()
      app.destroy()
    }
  })

  it('切换每页数时回到第 1 页并通过 query 回调通知宿主', () => {
    const container = document.createElement('div')
    const queries: DataTableQuery[] = []
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: Array.from({ length: 6 }, (_, id) => ({ id, name: `User ${id}`, role: 'Viewer' })),
        page: 2,
        pageSize: 1,
        pageSizeOptions: [1, 2, 4],
        onQueryChange: query => queries.push(query)
      })
    })
    app.mount(container)

    const select = container.querySelector('.vobs-data-table__page-size-select') as HTMLSelectElement
    select.value = '4'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(queries[0]).toMatchObject({ page: 1, pageSize: 4 })
    app.destroy()
  })

  it('显式设置分页模式后，即使只有一页也保留每页数控件', () => {
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: [{ id: 1, name: 'Ada', role: 'Admin' }],
        pageSize: 10,
        paginationMode: 'simple'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-data-table__page-size-select')).not.toBeNull()
    app.destroy()
  })

  it('all 模式可以通过页码输入跳转', () => {
    const container = document.createElement('div')
    const queries: DataTableQuery[] = []
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: Array.from({ length: 4 }, (_, id) => ({ id, name: `User ${id}`, role: 'Viewer' })),
        pageSize: 1,
        paginationMode: 'all',
        onQueryChange: query => queries.push(query)
      })
    })
    app.mount(container)

    const input = container.querySelector('.vobs-data-table__jump-input') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input.inputMode).toBe('numeric')
    expect(input.pattern).toBe('[0-9]*')
    input.value = '3'
    container.querySelector('.vobs-data-table__pagination-jump')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
    expect(queries[queries.length - 1]?.page).toBe(3)
    app.destroy()
  })

  it('pagination 插槽可以完全接管右侧区域并使用分页上下文', () => {
    const container = document.createElement('div')
    const queries: DataTableQuery[] = []
    const app = createVobs({
      render: () => KitDataTable<User>({
        columns,
        rows: Array.from({ length: 4 }, (_, id) => ({ id, name: `User ${id}`, role: 'Viewer' })),
        pageSize: 1,
        pagination: context => {
          const button = createElement('button')
          setAttribute(button, 'type', 'button')
          setAttribute(button, 'data-testid', 'custom-pagination')
          addEventListener(button, 'click', () => context.goToPage(2))
          return button
        },
        onQueryChange: query => queries.push(query)
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-data-table__pagination')).toBeNull()
    ;(container.querySelector('[data-testid="custom-pagination"]') as HTMLButtonElement).click()
    expect(queries[queries.length - 1]?.page).toBe(2)
    app.destroy()
  })

  it('列设置至少保留一列，并通过回调返回可见列 id', () => {
    const container = document.createElement('div')
    const onChange = vi.fn()
    const app = createVobs({
      render: () => KitColumnSettings({ columns, visibleColumnIds: ['name'], onChange })
    })
    app.mount(container)
    const role = container.querySelectorAll('input')[1] as HTMLInputElement
    role.checked = true
    role.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(['name', 'role'])
    app.destroy()
  })

  it('列设置支持恢复、保存顺序和宽度，并可重置', () => {
    const saved: {
      visibleColumnIds: string[]
      columnOrder: string[]
      columnWidths: Record<string, string | number>
    } = {
      visibleColumnIds: ['role', 'name'],
      columnOrder: ['role', 'name'],
      columnWidths: { name: '160px' }
    }
    const persistence: DataTableColumnSettingsPersistence = {
      load: vi.fn(() => saved),
      save: vi.fn((value: DataTableColumnSettings) => {
        saved.visibleColumnIds = [...value.visibleColumnIds]
        saved.columnOrder = [...value.columnOrder]
        saved.columnWidths = { ...value.columnWidths }
      }),
      reset: vi.fn(() => {
        saved.visibleColumnIds = ['name', 'role']
        saved.columnOrder = ['name', 'role']
        saved.columnWidths = {}
      })
    }
    const settingsChanges: string[][] = []
    const container = document.createElement('div')
    const app = createVobs({
      render: () => KitColumnSettings<User>({
        columns,
        persistence,
        onSettingsChange: value => settingsChanges.push([...value.columnOrder])
      })
    })
    app.mount(container)

    expect([...container.querySelectorAll('.vobs-column-settings__layout-label')].map(label => label.textContent))
      .toEqual(['Role', 'Name'])
    expect((container.querySelector(
      '.vobs-column-settings__layout-option[data-column-id="name"] .vobs-column-settings__width'
    ) as HTMLInputElement).value).toBe('160px')

    ;(container.querySelector('.vobs-column-settings__move--up:not(:disabled)') as HTMLButtonElement).click()
    expect(persistence.save).toHaveBeenCalled()
    expect(settingsChanges.at(-1)).toEqual(['name', 'role'])

    const width = container.querySelector(
      '.vobs-column-settings__layout-option[data-column-id="name"] .vobs-column-settings__width'
    ) as HTMLInputElement
    width.value = '180px'
    width.dispatchEvent(new Event('change', { bubbles: true }))
    expect(persistence.save).toHaveBeenLastCalledWith(expect.objectContaining({
      columnWidths: { name: '180px' }
    }))

    ;(container.querySelector('.vobs-column-settings__reset') as HTMLButtonElement).click()
    expect(persistence.reset).toHaveBeenCalledOnce()
    expect(settingsChanges.at(-1)).toEqual(['name', 'role'])
    app.destroy()
  })

  it('受控列设置变化会同步到同页数据表', async () => {
    const settings = state<DataTableColumnSettings>({
      visibleColumnIds: ['name', 'role'],
      columnOrder: ['name', 'role'],
      columnWidths: {}
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        root.append(
          KitColumnSettings<User>({
            columns,
            get settings() { return settings.value },
            onSettingsChange: value => { settings.value = value }
          }) as Node,
          KitDataTable<User>({
            columns,
            rows: [{ id: 1, name: 'Ada', role: 'Admin' }],
            get columnSettings() { return settings.value }
          }) as Node
        )
        return root
      }
    })
    app.mount(container)

    const width = container.querySelector('.vobs-column-settings__width') as HTMLInputElement
    width.value = '180px'
    width.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
    expect(container.querySelector('thead th[data-column-id="name"]')?.getAttribute('style'))
      .toContain('width: 180px')
    app.destroy()
  })

  it('列设置持久化工厂支持存取和重置', () => {
    const values = new Map<string, unknown>()
    const get = vi.fn((key: string) => values.get(key) ?? null)
    const set = vi.fn((key: string, value: unknown) => { values.set(key, value) })
    const remove = vi.fn((key: string) => { values.delete(key) })
    const storage: DataTableColumnSettingsStorage = {
      get<T>(key: string): T | null {
        return get(key) as T | null
      },
      set<T>(key: string, value: T): void {
        set(key, value)
      },
      remove
    }
    const persistence = createColumnSettingsPersistence(storage, 'users.columns')
    const settings = {
      visibleColumnIds: ['name'],
      columnOrder: ['name', 'role'],
      columnWidths: { name: 160 }
    }

    persistence.save(settings)
    expect(persistence.load()).toEqual(settings)
    persistence.reset?.()
    expect(persistence.load()).toBeNull()
    expect(set).toHaveBeenCalledWith('users.columns', settings)
    expect(remove).toHaveBeenCalledWith('users.columns')
  })

  it('本地持久化在损坏值和无浏览器存储时回退为空设置', () => {
    const values = new Map<string, string>([['users.columns', '{bad json']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) }
    }
    const persistence = createLocalColumnSettingsPersistence('users.columns', storage)
    expect(persistence.load()).toBeUndefined()

    const settings = {
      visibleColumnIds: ['name'],
      columnOrder: ['name'],
      columnWidths: {}
    }
    persistence.save(settings)
    expect(persistence.load()).toEqual(settings)
    persistence.reset?.()
    expect(persistence.load()).toBeUndefined()
  })
})
