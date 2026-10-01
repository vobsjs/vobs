import { effect, state, type Signal, memo } from '@vobs/reactivity'
import {
  addEventListener,
  createElement,
  createFragment,
  createText,
  insertBefore,
  insertList,
  insertDynamic,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindStyle,
  hasProp,
  normalizePixels,
  normalizeColumnSettings,
  orderColumns,
  readProp,
  resolveSlot,
  setOptionalAttribute
} from './utils'
import { defaultIcons } from './icons'
import type {
  DataTableColumn,
  DataTableChildren,
  DataTableColumnSettings,
  DataTableIcons,
  DataTablePage,
  DataTableQuery,
  DataTableResourceData,
  DataTableSort,
  DataTableSortType,
  KitDataTableProps
} from './types'

const internalQueries = new WeakMap<object, ReturnType<typeof state<DataTableQuery>>>()

const DEFAULT_PAGE_SIZE = 25
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_ROW_HEIGHT = 40
const DEFAULT_VIRTUAL_HEIGHT = 400
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function KitDataTable<Row = Record<string, unknown>>(props: KitDataTableProps<Row> = {}): VobsNode {
  const root = createElement('section')
  const toolbar = createElement('div')
  const viewport = createElement('div')
  const table = createElement('table')
  const head = createElement('thead')
  const body = createElement('tbody')
  const footer = createElement('footer')
  const scrollTop = state(0)
  internalQueries.set(props, state({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: null,
    filters: {}
  }))

  bindClassList(root, props, () => [
    'vobs-data-table',
    readProp(props, 'stickyHeader', true) ? 'vobs-data-table--sticky-header' : undefined
  ])
  bindCommonAttributes(root, props, [
    'columns', 'rows', 'resource', 'rowKey', 'page', 'pageSize', 'total', 'sort', 'filters', 'columnSettings',
    'sortingMode', 'visibleColumnIds', 'virtual', 'stickyHeader', 'virtualHeight', 'rowHeight', 'overscan', 'loading', 'empty',
    'error', 'toolbar', 'footer', 'pagination', 'paginationMode', 'icons',
    'previousLabel', 'nextLabel', 'jumpToLabel', 'jumpToPlaceholder', 'jumpToSubmitLabel',
    'pageSizeOptions', 'pageSizeLabel', 'pageLabel',
    'onQueryChange', 'onRowClick', 'onVisibleColumnIdsChange'
  ])
  bindStyle(root, props)
  setAttribute(toolbar, 'class', 'vobs-data-table__toolbar')
  setAttribute(viewport, 'class', 'vobs-data-table__viewport')
  setAttribute(viewport, 'data-vobs-scrollable', 'true')
  setAttribute(table, 'class', 'vobs-data-table__table')
  setAttribute(footer, 'class', 'vobs-data-table__footer')
  /*
   * 语义属性要落在**真正的 <table>** 上。
   *
   * 作者传的 role / aria-label 会经通用属性通道落到外层 <section>（bindCommonAttributes 的 skip
   * 列表里没有它们），而读屏在"表格"这一层用的是 <table> 自己的名字 —— 外层 section 上的名字只会
   * 把它变成一个 region，表格本身仍然无名。这里把这两项同步给 table（外层保持不变，纯加法）。
   */
  effect(() => {
    const role = readProp<unknown>(props, 'role', undefined)
    if (typeof role === 'string') setAttribute(table, 'role', role)
    const label = readProp<unknown>(props, 'aria-label', undefined)
    if (typeof label === 'string') setAttribute(table, 'aria-label', label)
  })

  if (hasProp(props, 'toolbar')) insertDynamic(toolbar, null, () => resolveSlot(readProp(props, 'toolbar', undefined)))
  effect(() => { setProperty(toolbar, 'hidden', !hasProp(props, 'toolbar')) })
  effect(() => {
    const virtual = readProp(props, 'virtual', false)
    setProperty(viewport, 'tabIndex', virtual ? 0 : -1)
    setAttribute(viewport, 'style', virtual ? `max-height: ${normalizeHeight(readProp(props, 'virtualHeight', DEFAULT_VIRTUAL_HEIGHT))}; overflow: auto` : '')
  })
  addEventListener(viewport, 'scroll', () => { scrollTop.value = viewport.scrollTop })

  insertDynamic(head, null, () => createHeader(props))
  /*
   * 页面数据（筛选/排序/分页后的行）放进 memo：单元格经由它读行，数据一变必然重跑，
   * 不依赖"insertList 传下来的 item 代理"这一层（我实测那一层没能让复用的行更新内容）。
   */
  const page = memo(() => resolvePage(props))
  // tbody 走 keyed 调和：行按 key 复用/移动，而不是每轮整块重建（实测改 1 行原本重建 6014 个元素）
  insertList(body, null, () => bodyItems(props, page.value, scrollTop.value), item => renderBodyItem(item, props, page), item => item.key)
  insertBefore(table, head, null)
  insertBefore(table, body, null)
  insertBefore(viewport, table, null)
  insertDynamic(footer, null, () => createFooter(props))
  effect(() => { setProperty(footer, 'hidden', !shouldShowFooter(props)) })

  insertBefore(root, toolbar, null)
  insertBefore(root, viewport, null)
  insertBefore(root, footer, null)
  return root
}

function createHeader<Row>(props: KitDataTableProps<Row>): VobsNode {
  const columns = visibleColumns(props)
  return createFragment((parent, anchor) => {
    const row = createElement('tr')
    for (const column of columns) {
      const cell = createElement('th')
      setAttribute(cell, 'scope', 'col')
      setAttribute(cell, 'data-column-id', column.id)
      applyColumnStyle(cell, column, readProp<DataTableColumnSettings | undefined>(props, 'columnSettings', undefined))
      if (column.sortable) insertBefore(cell, createSortButton(props, column, cell), null)
      else insertBefore(cell, createText(column.label), null)
      insertBefore(row, cell, null)
    }
    insertBefore(parent, row, anchor)
  })
}

function createSortButton<Row>(props: KitDataTableProps<Row>, column: DataTableColumn<Row>, cell: Element): VobsNode {
  const button = createElement('button')
  const label = createElement('span')
  const icon = createElement('span')
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', 'vobs-data-table__sort')
  setAttribute(button, 'aria-label', `Sort by ${column.label}`)
  setAttribute(label, 'class', 'vobs-data-table__sort-label')
  setAttribute(icon, 'class', 'vobs-data-table__sort-icon')
  insertBefore(label, createText(column.label), null)
  insertDynamic(icon, null, () => resolveSlot(sortIcon(props, currentSort(props), column.id)))
  effect(() => {
    const sort = currentSort(props)
    const direction = sort?.columnId === column.id ? sort.direction : undefined
    setOptionalAttribute(cell, 'aria-sort', direction
      ? direction === 'asc' ? 'ascending' : 'descending'
      : undefined)
    setOptionalAttribute(cell, 'data-sort-direction', direction)
  })
  addEventListener(button, 'click', () => {
    const current = currentSort(props)
    const next = current?.columnId === column.id
      ? current.direction === 'asc' ? createSort(column, 'desc') : null
      : createSort(column, 'asc')
    emitQuery(props, { ...currentQuery(props), sort: next, page: 1 })
  })
  insertBefore(button, label, null)
  insertBefore(button, icon, null)
  return button
}

/**
 * tbody 的内容模型：状态行 / 虚拟化 spacer / 数据行，统一成"带 key 的列表"。
 *
 * 原来这里直接 `createFragment` + 手写 `insertBefore` 循环 —— 每次 effect 重跑都整块重建：
 * 实测 2000 行改 1 行会创建 6014 个元素 / 240ms，而 keyed 调和同场景是 14 个元素 / 6ms。
 * 行复用、移动、多行重排在这里原本全是死代码。
 *
 * 行 key 优先用 `rowKey`（数据身份，支持重排复用）；没写就退化成位置 key ——
 * 至少"只改内容"时能复用行，保住行内焦点与 DOM 状态。
 */
type BodyItem<Row> =
  | { readonly key: string; readonly kind: 'state'; readonly state: 'loading' | 'empty' | 'error'; readonly error?: Error }
  | { readonly key: string; readonly kind: 'spacer'; readonly height: number }
  | { readonly key: string; readonly kind: 'row'; readonly row: Row; readonly index: number }

function bodyItems<Row>(
  props: KitDataTableProps<Row>,
  page: { readonly rows: readonly Row[]; readonly total: number },
  scrollTop: number
): readonly BodyItem<Row>[] {
  const resource = readProp<KitDataTableProps<Row>['resource'] | undefined>(props, 'resource', undefined)
  if (resource?.error.value) return [{ key: 'state:error', kind: 'state', state: 'error', error: resource.error.value }]
  if (resource?.loading.value && resource.data.value === null) return [{ key: 'state:loading', kind: 'state', state: 'loading' }]

  if (page.rows.length === 0) return [{ key: 'state:empty', kind: 'state', state: 'empty' }]
  const window = resolveWindow(props, page.rows.length, scrollTop)
  const rowKey = readProp<KitDataTableProps<Row>['rowKey'] | undefined>(props, 'rowKey', undefined)
  const items: BodyItem<Row>[] = []
  if (window.before > 0) items.push({ key: 'spacer:before', kind: 'spacer', height: window.before })
  for (let index = window.start; index < window.end; index++) {
    const row = page.rows[index]
    const key = rowKey ? `row:${String(rowKey(row, index))}` : `pos:${index}`
    items.push({ key, kind: 'row', row, index })
  }
  if (window.after > 0) items.push({ key: 'spacer:after', kind: 'spacer', height: window.after })
  return items
}

function renderBodyItem<Row>(
  item: BodyItem<Row>,
  props: KitDataTableProps<Row>,
  page: { readonly value: { readonly rows: readonly Row[] } }
): VobsNode {
  if (item.kind === 'state') return createStateRow(props, item.state, item.error)
  if (item.kind === 'spacer') return createSpacerRow(visibleColumns(props).length, item.height)
  // 行数据用 getter 传进去：单元格在 effect 内取值 → 数据一变就重跑（行节点本身被复用）
  return createRow(props, item.index, visibleColumns(props), () => page.value.rows[item.index] ?? item.row)
}

function createStateRow<Row>(props: KitDataTableProps<Row>, kind: 'loading' | 'empty' | 'error', error?: Error): VobsNode {
  const row = createElement('tr')
  const cell = createElement('td')
  setAttribute(cell, 'class', `vobs-data-table__state vobs-data-table__state--${kind}`)
  setAttribute(cell, 'colspan', String(Math.max(1, visibleColumns(props).length)))
  let content: ReturnType<typeof resolveSlot>
  if (kind === 'error') {
    const fallback = readProp<KitDataTableProps<Row>['error'] | undefined>(props, 'error', undefined)
    const resource = readProp<KitDataTableProps<Row>['resource'] | undefined>(props, 'resource', undefined)
    content = fallback ? resolveSlot(fallback(error!, () => resource?.refetch() ?? Promise.resolve())) : createText(error?.message ?? 'Unable to load data')
  } else {
    content = resolveSlot(readProp<DataTableChildren | undefined>(props, kind, undefined))
      ?? createText(kind === 'loading' ? 'Loading...' : 'No data')
  }
  if (content) insertBefore(cell, content, null)
  insertBefore(row, cell, null)
  return row
}

function createRow<Row>(
  props: KitDataTableProps<Row>,
  index: number,
  columns: readonly DataTableColumn<Row>[],
  getRow: () => Row
): VobsNode {
  const tableRow = createElement('tr')
  const rowKey = readProp<KitDataTableProps<Row>['rowKey'] | undefined>(props, 'rowKey', undefined)
  if (rowKey) setOptionalAttribute(tableRow, 'data-row-key', rowKey(getRow(), index))
  const onRowClick = readProp<KitDataTableProps<Row>['onRowClick'] | undefined>(props, 'onRowClick', undefined)
  if (onRowClick) {
    setProperty(tableRow, 'tabIndex', 0)
    setAttribute(tableRow, 'data-clickable', 'true')
    // 事件时再取当前行：行节点会被复用，闭包里那份可能是旧的
    addEventListener(tableRow, 'click', () => onRowClick(getRow(), index))
    /*
     * 键盘激活。行有 `tabIndex=0`、也带了 `data-clickable`，但原来只绑了 click ——
     * 键盘用户能 Tab 到行上、按回车/空格却什么都不会发生。
     */
    addEventListener(tableRow, 'keydown', event => {
      const keyboardEvent = event as KeyboardEvent
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
      // 空格默认会滚动页面，必须挡掉
      keyboardEvent.preventDefault?.()
      onRowClick(getRow(), index)
    })
  }
  for (const column of columns) {
    const cell = createElement('td')
    setAttribute(cell, 'data-column-id', column.id)
    applyColumnStyle(cell, column, readProp<DataTableColumnSettings | undefined>(props, 'columnSettings', undefined))
    insertDynamic(cell, null, () => {
      // 在 effect 内取行：数据变化会被追踪到
      const row = getRow()
      return resolveSlot(column.render
        ? column.render(row, index)
        : column.key === undefined ? undefined : readRowValue(row, column.key))
    })
    insertBefore(tableRow, cell, null)
  }
  return tableRow
}

function createSpacerRow(columnCount: number, height: number): VobsNode {
  const row = createElement('tr')
  const cell = createElement('td')
  setAttribute(cell, 'class', 'vobs-data-table__spacer')
  setAttribute(cell, 'colspan', String(Math.max(1, columnCount)))
  setAttribute(cell, 'style', `height: ${height}px`)
  insertBefore(row, cell, null)
  return row
}

function createFooter<Row>(props: KitDataTableProps<Row>): VobsNode {
  const custom = readProp<KitDataTableProps<Row>['footer'] | undefined>(props, 'footer', undefined)
  if (custom !== undefined) return resolveSlot(custom) ?? createText('')
  const pagination = resolvePaginationState(props)
  const root = createElement('div')
  const summary = createElement('span')
  setAttribute(root, 'class', 'vobs-data-table__footer-content')
  setAttribute(summary, 'class', 'vobs-data-table__summary')
  insertBefore(summary, createText(pageLabel(
    props,
    pagination.page,
    pagination.pageCount,
    pagination.total,
    pagination.visibleCount,
    pagination.pageSize
  )), null)
  const actions = hasProp(props, 'pagination')
    ? createCustomPagination(props, pagination)
    : createPagination(props, pagination)
  insertBefore(root, summary, null)
  if (actions) insertBefore(root, actions, null)
  return root
}

interface DataTablePaginationState {
  readonly page: number
  readonly pageCount: number
  readonly pageSize: number
  readonly total: number
  readonly visibleCount: number
}

function createCustomPagination<Row>(
  props: KitDataTableProps<Row>,
  pagination: DataTablePaginationState
): VobsNode | null {
  const custom = readProp<KitDataTableProps<Row>['pagination'] | undefined>(props, 'pagination', undefined)
  if (custom === undefined) return null
  const value = typeof custom === 'function'
    ? custom({
      page: pagination.page,
      pageCount: pagination.pageCount,
      pageSize: pagination.pageSize,
      pageSizeOptions: pageSizeOptions(props, pagination.pageSize),
      total: pagination.total,
      visibleCount: pagination.visibleCount,
      goToPage: page => goToPage(props, page, pagination.pageCount),
      setPageSize: pageSize => setPageSize(props, pageSize)
    })
    : custom
  return resolveSlot(value)
}

function createPagination<Row>(
  props: KitDataTableProps<Row>,
  pagination: DataTablePaginationState
): VobsNode {
  const root = createElement('div')
  const mode = readProp<NonNullable<KitDataTableProps<Row>['paginationMode']>>(props, 'paginationMode', 'simple')
  setAttribute(root, 'class', 'vobs-data-table__pagination')
  setAttribute(root, 'data-mode', mode)
  insertBefore(root, createPageButton(props, 'previous', pagination), null)

  if (mode !== 'simple') {
    const pages = createElement('div')
    setAttribute(pages, 'class', 'vobs-data-table__pagination-pages')
    for (const item of buildPaginationItems(pagination.page, pagination.pageCount)) {
      insertBefore(pages, typeof item === 'number'
        ? createPageNumberButton(props, item, pagination.page)
        : createPageEllipsis(item), null)
    }
    insertBefore(root, pages, null)
  }

  insertBefore(root, createPageButton(props, 'next', pagination), null)
  if (mode === 'all') insertBefore(root, createJumpControl(props, pagination), null)
  insertBefore(root, createPageSizeControl(props, pagination), null)
  return root
}

function createPageButton<Row>(
  props: KitDataTableProps<Row>,
  direction: 'previous' | 'next',
  pagination: DataTablePaginationState
): VobsNode {
  const button = createElement('button')
  const label = direction === 'previous'
    ? readProp(props, 'previousLabel', 'Previous')
    : readProp(props, 'nextLabel', 'Next')
  const disabled = direction === 'previous'
    ? pagination.page <= 1
    : pagination.page >= pagination.pageCount
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', 'vobs-data-table__page-button')
  setAttribute(button, 'aria-label', label)
  setProperty(button, 'disabled', disabled)
  const icons = resolveIcons(props)
  const icon = direction === 'previous' ? icons.previous : icons.next
  const node = icon === undefined ? undefined : resolveSlot(icon)
  if (node) insertBefore(button, node, null)
  addEventListener(button, 'click', () => {
    if (disabled) return
    const query = currentQuery(props)
    goToPage(props, direction === 'previous' ? query.page - 1 : query.page + 1, pagination.pageCount)
  })
  return button
}

function createPageNumberButton<Row>(props: KitDataTableProps<Row>, page: number, currentPage: number): VobsNode {
  const button = createElement('button')
  const active = page === currentPage
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', `vobs-data-table__page-button${active ? ' is-active' : ''}`)
  setAttribute(button, 'aria-label', `Page ${page}`)
  if (active) setAttribute(button, 'aria-current', 'page')
  insertBefore(button, createText(String(page)), null)
  addEventListener(button, 'click', () => goToPage(props, page, resolvePaginationState(props).pageCount))
  return button
}

function createPageEllipsis(side: 'ellipsis-left' | 'ellipsis-right'): VobsNode {
  const ellipsis = createElement('span')
  setAttribute(ellipsis, 'class', 'vobs-data-table__page-ellipsis')
  setAttribute(ellipsis, 'aria-hidden', 'true')
  setAttribute(ellipsis, 'data-side', side)
  insertBefore(ellipsis, createText('...'), null)
  return ellipsis
}

function createJumpControl<Row>(props: KitDataTableProps<Row>, pagination: DataTablePaginationState): VobsNode {
  const root = createElement('form')
  const label = createElement('label')
  const input = createElement('input') as HTMLInputElement
  const submit = createElement('button')
  const jumpLabel = readProp(props, 'jumpToLabel', 'Go to')
  setAttribute(root, 'class', 'vobs-data-table__pagination-jump')
  setAttribute(label, 'class', 'vobs-data-table__jump-label')
  setAttribute(input, 'class', 'vobs-data-table__jump-input')
  setAttribute(input, 'type', 'text')
  setAttribute(input, 'inputmode', 'numeric')
  setAttribute(input, 'pattern', '[0-9]*')
  setAttribute(input, 'autocomplete', 'off')
  setAttribute(input, 'aria-label', jumpLabel)
  setAttribute(input, 'placeholder', readProp(props, 'jumpToPlaceholder', 'Page'))
  setProperty(input, 'value', String(pagination.page))
  setAttribute(submit, 'type', 'submit')
  setAttribute(submit, 'class', 'vobs-data-table__page-button vobs-data-table__jump-submit')
  setAttribute(submit, 'aria-label', readProp(props, 'jumpToSubmitLabel', 'Go'))
  insertBefore(label, createText(jumpLabel), null)
  insertBefore(label, input, null)
  insertBefore(submit, createText(readProp(props, 'jumpToSubmitLabel', 'Go')), null)
  addEventListener(input, 'input', () => {
    const value = input.value.replace(/[^0-9]/gu, '')
    if (value !== input.value) setProperty(input, 'value', value)
  })
  addEventListener(root, 'submit', event => {
    event.preventDefault()
    if (!/^\d+$/u.test(input.value)) return
    const requested = Number(input.value)
    if (!Number.isSafeInteger(requested)) return
    goToPage(props, requested, pagination.pageCount)
  })
  insertBefore(root, label, null)
  insertBefore(root, submit, null)
  return root
}

function createPageSizeControl<Row>(props: KitDataTableProps<Row>, pagination: DataTablePaginationState): VobsNode {
  const root = createElement('label')
  const select = createElement('select') as HTMLSelectElement
  const label = readProp(props, 'pageSizeLabel', 'Rows per page')
  setAttribute(root, 'class', 'vobs-data-table__page-size')
  setAttribute(select, 'class', 'vobs-data-table__page-size-select')
  setAttribute(select, 'aria-label', label)
  insertBefore(root, createText(label), null)
  for (const optionValue of pageSizeOptions(props, pagination.pageSize)) {
    const option = createElement('option') as HTMLOptionElement
    setAttribute(option, 'value', String(optionValue))
    setProperty(option, 'textContent', String(optionValue))
    insertBefore(select, option, null)
  }
  setProperty(select, 'value', String(pagination.pageSize))
  addEventListener(select, 'change', () => {
    setPageSize(props, Number(select.value))
  })
  insertBefore(root, select, null)
  return root
}

function resolvePage<Row>(props: KitDataTableProps<Row>): { rows: readonly Row[]; total: number } {
  const resource = readProp<KitDataTableProps<Row>['resource'] | undefined>(props, 'resource', undefined)
  const supplied = resource?.data.value ?? readProp<readonly Row[]>(props, 'rows', [])
  const source = normalizeRows(supplied)
  const query = currentQuery(props)
  /*
   * 筛选与排序按**全部列**走，与"列是否可见"无关。
   *
   * 原来这里传的是 `visibleColumns(props)`：把某个可筛选列隐藏掉，它的筛选条件就静默不再生效
   * —— 数据悄悄变了（实测把被筛选的那列隐藏后行数从 2 变回 3），而查询条件里明明还在。
   * 可见性是显示层的事，不该改变数据语义。
   */
  const rows = applyFiltersAndSort(source.rows, allColumns(props), query, readProp(props, 'sortingMode', 'client'))
  const remoteTotal = source.total ?? readProp<number | undefined>(props, 'total', undefined)
  const total = remoteTotal ?? rows.length
  const isRemotePage = source.total !== undefined || readProp(props, 'total', undefined) !== undefined
  if (isRemotePage) return { rows, total }
  /*
   * 越界页要收敛到有效范围。
   *
   * 原来这里直接用 query.page：作者（或内部状态）给了超出范围的页码时，
   * pageCount 算出来是 2、slice 却是空的 —— 摘要显示 "5/2"、表格显示 "No data"，
   * 一个"假空态"。`goToPage` 那边本来就有 clamp，只有"从外面传进来的页"漏了。
   * 只收敛**渲染**用的页号，emit 出去的 query 仍是作者给的值（不悄悄改对外契约）。
   */
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
  const safePage = Math.min(Math.max(1, query.page), pageCount)
  const start = (safePage - 1) * query.pageSize
  return { rows: rows.slice(start, start + query.pageSize), total }
}

function normalizeRows<Row>(value: DataTableResourceData<Row> | readonly Row[]): DataTablePage<Row> {
  if (isRowArray(value)) return { rows: value }
  return { rows: value.rows ?? [], total: value.total }
}

function isRowArray<Row>(value: DataTableResourceData<Row> | readonly Row[]): value is readonly Row[] {
  return Array.isArray(value)
}

function applyFiltersAndSort<Row>(
  rows: readonly Row[],
  columns: readonly DataTableColumn<Row>[],
  query: DataTableQuery,
  sortingMode: 'client' | 'server'
): readonly Row[] {
  let result = rows
  for (const column of columns) {
    const value = query.filters[column.id]
    if (value === undefined || value === null || value === '') continue
    result = result.filter(row => column.filter
      ? column.filter(row, value)
      : String(column.key === undefined ? '' : readRowValue(row, column.key))
        .toLocaleLowerCase().includes(String(value).toLocaleLowerCase()))
  }
  if (!query.sort || sortingMode === 'server') return result
  const column = columns.find(candidate => candidate.id === query.sort!.columnId)
  if (!column) return result
  const direction = query.sort.direction
  return result
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareRows(left.row, right.row, column, direction)
      return compared === 0 ? left.index - right.index : compared
    })
    .map(entry => entry.row)
}

function compareRows<Row>(
  left: Row,
  right: Row,
  column: DataTableColumn<Row>,
  direction: 'asc' | 'desc'
): number {
  const multiplier = direction === 'asc' ? 1 : -1
  if (column.compare) return multiplier * column.compare(left, right)
  const leftValue = column.sortValue
    ? column.sortValue(left)
    : column.key === undefined ? undefined : readRowValue(left, column.key)
  const rightValue = column.sortValue
    ? column.sortValue(right)
    : column.key === undefined ? undefined : readRowValue(right, column.key)
  const leftMissing = isMissingSortValue(leftValue, column.sortType)
  const rightMissing = isMissingSortValue(rightValue, column.sortType)
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0
    return leftMissing ? 1 : -1
  }
  return multiplier * compareSortValues(leftValue, rightValue, column.sortType)
}

function compareSortValues(left: unknown, right: unknown, sortType: DataTableSortType | undefined): number {
  if (sortType === 'number') return compareNumbers(left, right)
  if (sortType === 'date') return compareDates(left, right)
  if (sortType === 'boolean') return Number(Boolean(left)) - Number(Boolean(right))
  if (sortType === 'text') return compareText(left, right)
  if (typeof left === 'number' && typeof right === 'number') return compareNumbers(left, right)
  if (left instanceof Date && right instanceof Date) return compareNumbers(left.getTime(), right.getTime())
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return compareText(left, right)
}

function compareNumbers(left: unknown, right: unknown): number {
  return Number(left) - Number(right)
}

function compareDates(left: unknown, right: unknown): number {
  const leftTime = left instanceof Date ? left.getTime() : Date.parse(String(left))
  const rightTime = right instanceof Date ? right.getTime() : Date.parse(String(right))
  return leftTime - rightTime
}

function compareText(left: unknown, right: unknown): number {
  return textCollator.compare(String(left), String(right))
}

function createSort<Row>(column: DataTableColumn<Row>, direction: 'asc' | 'desc'): DataTableSort {
  return column.sortKey
    ? { columnId: column.id, direction, sortKey: column.sortKey }
    : { columnId: column.id, direction }
}

function isMissingSortValue(value: unknown, sortType: DataTableSortType | undefined): boolean {
  if (value === undefined || value === null || value === '') return true
  if (sortType === 'number') return !Number.isFinite(Number(value))
  if (sortType === 'date') {
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value))
    return !Number.isFinite(timestamp)
  }
  return false
}

function resolveWindow<Row>(props: KitDataTableProps<Row>, count: number, scrollTop: number): { start: number; end: number; before: number; after: number } {
  if (!readProp(props, 'virtual', false)) return { start: 0, end: count, before: 0, after: 0 }
  const rowHeight = normalizePositive(readProp(props, 'rowHeight', DEFAULT_ROW_HEIGHT), DEFAULT_ROW_HEIGHT)
  const viewportHeight = normalizePositive(readProp(props, 'virtualHeight', DEFAULT_VIRTUAL_HEIGHT), DEFAULT_VIRTUAL_HEIGHT)
  const overscan = Math.max(0, Math.floor(readProp(props, 'overscan', 5)))
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight }
}

function unwrapQueryValue(value: number | Signal<number>): number {
  return typeof value === 'number' ? value : value.value
}

function currentQuery<Row>(props: KitDataTableProps<Row>): DataTableQuery {
  const internal = internalQueries.get(props)?.value
  const page = unwrapQueryValue(readProp(props, 'page', internal?.page ?? 1))
  const pageSize = unwrapQueryValue(readProp(props, 'pageSize', internal?.pageSize ?? DEFAULT_PAGE_SIZE))
  return {
    page: Math.max(1, Math.floor(page)),
    pageSize: normalizePositive(pageSize, DEFAULT_PAGE_SIZE),
    sort: readProp<DataTableSort | null>(props, 'sort', internal?.sort ?? null),
    filters: readProp<Readonly<Record<string, unknown>>>(props, 'filters', internal?.filters ?? {})
  }
}

function readSignalProp<T>(props: object, name: string): Signal<T> | undefined {
  const value = Reflect.get(props, name) as Signal<T> | undefined
  return value && typeof value === 'object' && 'value' in value ? value : undefined
}

function emitQuery<Row>(props: KitDataTableProps<Row>, query: DataTableQuery): void {
  const internal = internalQueries.get(props)
  if (internal) internal.value = query
  const pageSignal = readSignalProp<number>(props, 'page')
  if (pageSignal) pageSignal.value = query.page
  const pageSizeSignal = readSignalProp<number>(props, 'pageSize')
  if (pageSizeSignal) pageSizeSignal.value = query.pageSize
  readProp<KitDataTableProps<Row>['onQueryChange'] | undefined>(props, 'onQueryChange', undefined)?.(query)
}

function currentSort<Row>(props: KitDataTableProps<Row>): DataTableSort | null {
  return currentQuery(props).sort
}

/** 全部列（含 `visible: false` 与不在 visibleColumnIds 里的）：筛选/排序按数据语义走，不看可见性。 */
function allColumns<Row>(props: KitDataTableProps<Row>): readonly DataTableColumn<Row>[] {
  return readProp<readonly DataTableColumn<Row>[]>(props, 'columns', [])
}

function visibleColumns<Row>(props: KitDataTableProps<Row>): readonly DataTableColumn<Row>[] {
  const columns = readProp<readonly DataTableColumn<Row>[]>(props, 'columns', [])
  const rawSettings = readProp<DataTableColumnSettings | undefined>(props, 'columnSettings', undefined)
  const settings = rawSettings ? normalizeColumnSettings(columns, rawSettings) : undefined
  const ids = settings?.visibleColumnIds
    ?? readProp<readonly string[] | undefined>(props, 'visibleColumnIds', undefined)
  const visible = ids ? new Set(ids) : undefined
  return orderColumns(columns, settings?.columnOrder)
    .filter(column => column.visible !== false && (!visible || visible.has(column.id)))
}

function resolveIcons<Row>(props: KitDataTableProps<Row>): Required<DataTableIcons> {
  return { ...defaultIcons(), ...(readProp<DataTableIcons | undefined>(props, 'icons', undefined) ?? {}) }
}

function sortIcon<Row>(props: KitDataTableProps<Row>, sort: DataTableSort | null, columnId: string) {
  const icons = resolveIcons(props)
  if (sort?.columnId !== columnId) return icons.unsorted
  return sort.direction === 'asc' ? icons.ascending : icons.descending
}

function pageLabel<Row>(
  props: KitDataTableProps<Row>,
  page: number,
  pageCount: number,
  total: number,
  visibleCount: number,
  pageSize: number
): string {
  return readProp<KitDataTableProps<Row>['pageLabel'] | undefined>(props, 'pageLabel', undefined)
    ?. (page, pageCount, total, visibleCount, pageSize) ?? `${visibleCount}/${pageSize} - ${page}/${pageCount}`
}

function shouldShowFooter<Row>(props: KitDataTableProps<Row>): boolean {
  return hasProp(props, 'footer')
    || hasProp(props, 'pagination')
    || hasProp(props, 'paginationMode')
    || hasProp(props, 'pageSizeOptions')
    || resolvePage(props).total > currentQuery(props).pageSize
}

function resolvePaginationState<Row>(props: KitDataTableProps<Row>): DataTablePaginationState {
  const page = resolvePage(props)
  const query = currentQuery(props)
  const pageCount = Math.max(1, Math.ceil(page.total / query.pageSize))
  return {
    // 与 resolvePage 的收敛保持一致：否则摘要与页码按钮会显示越界的页
    page: Math.min(Math.max(1, query.page), pageCount),
    pageCount,
    pageSize: query.pageSize,
    total: page.total,
    visibleCount: page.rows.length
  }
}

function goToPage<Row>(props: KitDataTableProps<Row>, page: number, pageCount: number): void {
  const query = currentQuery(props)
  const nextPage = clampPage(page, pageCount)
  if (nextPage === query.page) return
  emitQuery(props, { ...query, page: nextPage })
}

function setPageSize<Row>(props: KitDataTableProps<Row>, pageSize: number): void {
  const query = currentQuery(props)
  const nextPageSize = normalizePositive(pageSize, query.pageSize)
  if (nextPageSize === query.pageSize) return
  emitQuery(props, { ...query, page: 1, pageSize: nextPageSize })
}

function pageSizeOptions<Row>(props: KitDataTableProps<Row>, currentPageSize: number): readonly number[] {
  const configured = readProp<readonly number[] | undefined>(props, 'pageSizeOptions', undefined)
    ?? DEFAULT_PAGE_SIZE_OPTIONS
  const values = configured
    .map(value => normalizePositive(value, 0))
    .filter(value => value > 0)
  if (!values.includes(currentPageSize)) values.push(currentPageSize)
  return [...new Set(values)].sort((left, right) => left - right)
}

type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right'

function buildPaginationItems(page: number, pageCount: number): readonly PaginationItem[] {
  const siblingCount = 1
  const totalVisible = siblingCount * 2 + 5
  if (pageCount <= totalVisible) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const left = Math.max(page - siblingCount, 2)
  const right = Math.min(page + siblingCount, pageCount - 1)
  const items: PaginationItem[] = [1]
  if (left > 2) items.push('ellipsis-left')
  for (let value = left; value <= right; value++) items.push(value)
  if (right < pageCount - 1) items.push('ellipsis-right')
  items.push(pageCount)
  return items
}

function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1
  return Math.min(pageCount, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)))
}

function applyColumnStyle<Row>(
  cell: Element,
  column: DataTableColumn<Row>,
  settings?: DataTableColumnSettings
): void {
  const width = settings?.columnWidths[column.id] ?? column.width
  const styles = [
    normalizePixels(width) ? `width: ${normalizePixels(width)}` : '',
    normalizePixels(column.minWidth) ? `min-width: ${normalizePixels(column.minWidth)}` : ''
  ].filter(Boolean).join('; ')
  if (styles) setAttribute(cell, 'style', styles)
  setOptionalAttribute(cell, 'data-align', column.align)
}

function normalizeHeight(value: number): string {
  return `${normalizePositive(value, DEFAULT_VIRTUAL_HEIGHT)}px`
}

function normalizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function readRowValue<Row>(row: Row, key: keyof Row): unknown {
  return row === null || row === undefined ? undefined : Reflect.get(row as object, key)
}
