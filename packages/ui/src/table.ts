import {
  addEventListener,
  createElement,
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  resolveSlot,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type TableAlign = 'start' | 'center' | 'end'

export type TableState = 'ok' | 'loading' | 'empty' | 'error'

export interface TableColumn<Row = Record<string, unknown>> {
  readonly id: string
  readonly label: string
  /** Header node (optional): a node or a function returning one — inserted dynamically and reactive to signals.
   *  Use: header controls like select-all checkboxes; when head is provided, label is not rendered. */
  readonly head?: VuiChildren | (() => VuiChildren)
  readonly key?: keyof Row
  readonly render?: (row: Row, index: number) => VuiChildren
  readonly align?: TableAlign
  /** Column width (number as px; strings pass through as-is, e.g. '18%'). */
  readonly width?: number | string
}

export interface TableProps<Row = Record<string, unknown>> extends VuiCommonProps {
  readonly columns?: readonly TableColumn<Row>[]
  readonly rows?: readonly Row[]
  readonly caption?: string
  readonly empty?: VuiChildren
  readonly rowKey?: (row: Row, index: number) => unknown
  readonly onRowClick?: (row: Row, index: number) => void
  /** Data state: ok (default) / loading (skeleton) / empty / error; derived from rows when absent. */
  readonly state?: TableState
  /** Number of skeleton rows in the loading state (default 5). */
  readonly loadingRows?: number
  /** Description content for the error state (defaults to "Failed to load data"). */
  readonly error?: VuiChildren
  /** Retry callback for the error state (a retry button appears in the error area when provided). */
  readonly onRetry?: () => void
  /** Row selection/highlight predicate: matching rows carry data-active="true". */
  readonly rowActive?: (row: Row, index: number) => boolean
  /** Uniform row height (number as px). */
  readonly rowHeight?: number
}

export function Table<Row = Record<string, unknown>>(props?: TableProps<Row>): VobsNode
export function Table(props?: TableProps<any>): VobsNode
export function Table<Row = Record<string, unknown>>(props: TableProps<Row> = {}): VobsNode {
  const root = createElement('table')
  const head = createElement('thead')
  const body = createElement('tbody')

  bindClassList(root, props, () => ['vui-table'])
  bindCommonAttributes(root, props, ['columns', 'rows', 'caption', 'empty', 'rowKey', 'onRowClick', 'state', 'loadingRows', 'error', 'onRetry', 'rowActive', 'rowHeight'])
  bindUserStyle(root, props)

  if (hasProp(props, 'caption')) {
    const caption = createElement('caption')
    const text = createText('')
    bindTextContent(text, () => readProp(props, 'caption', ''))
    insertBefore(caption, text, null)
    insertBefore(root, caption, null)
  }
  insertDynamic(head, null, () => createTableHead(props))
  insertDynamic(body, null, () => createTableBody(props))
  insertBefore(root, head, null)
  insertBefore(root, body, null)
  return root
}

export interface TablePanelProps<Row = Record<string, unknown>> extends VuiCommonProps {
  readonly columns?: readonly TableColumn<Row>[]
  readonly rows?: readonly Row[]
  readonly empty?: VuiChildren
  readonly footer?: VuiChildren
  readonly rowKey?: (row: Row, index: number) => unknown
  readonly onRowClick?: (row: Row, index: number) => void
  readonly state?: TableState
  readonly loadingRows?: number
  readonly error?: VuiChildren
  readonly onRetry?: () => void
  readonly rowActive?: (row: Row, index: number) => boolean
  readonly rowHeight?: number
}

export function TablePanel<Row = Record<string, unknown>>(props?: TablePanelProps<Row>): VobsNode
export function TablePanel(props?: TablePanelProps<any>): VobsNode
export function TablePanel<Row = Record<string, unknown>>(props: TablePanelProps<Row> = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-tablepanel'])
  bindCommonAttributes(root, props, ['columns', 'rows', 'empty', 'footer', 'rowKey', 'onRowClick', 'state', 'loadingRows', 'error', 'onRetry', 'rowActive', 'rowHeight'])
  bindUserStyle(root, props)

  const table = Table<Row>({
    get columns() { return readProp<readonly TableColumn<Row>[]>(props, 'columns', []) },
    get rows() { return readProp<readonly Row[]>(props, 'rows', []) },
    get empty() { return readProp<VuiChildren | undefined>(props, 'empty', undefined) },
    get rowKey() { return readProp<TablePanelProps<Row>['rowKey']>(props, 'rowKey', undefined) },
    get onRowClick() { return readProp<TablePanelProps<Row>['onRowClick']>(props, 'onRowClick', undefined) },
    get state() { return readProp<TableState | undefined>(props, 'state', undefined) },
    get loadingRows() { return readProp<number | undefined>(props, 'loadingRows', undefined) },
    get error() { return readProp<VuiChildren | undefined>(props, 'error', undefined) },
    get onRetry() { return readProp<(() => void) | undefined>(props, 'onRetry', undefined) },
    get rowActive() { return readProp<TablePanelProps<Row>['rowActive']>(props, 'rowActive', undefined) },
    get rowHeight() { return readProp<number | undefined>(props, 'rowHeight', undefined) }
  })
  insertBefore(root, table, null)

  if (hasProp(props, 'footer')) {
    const footer = createElement('div')
    setAttribute(footer, 'class', 'vui-tablepanel__foot')
    mountSlot(footer, props, 'footer')
    insertBefore(root, footer, null)
  }
  return root
}

function createTableHead<Row>(props: TableProps<Row>): VobsNode {
  const columns = readProp<readonly TableColumn<Row>[]>(props, 'columns', [])
  return createFragment((parent, anchor) => {
    const row = createElement('tr')
    for (const column of columns) {
      const cell = createElement('th')
      setAttribute(cell, 'scope', 'col')
      setAttribute(cell, 'data-column-id', column.id)
      applyAlignment(cell, column.align)
      if (column.width !== undefined) {
        setAttribute(cell, 'style', `width:${typeof column.width === 'number' ? `${column.width}px` : column.width}`)
      }
      const head = column.head
      if (head === undefined) {
        insertBefore(cell, createText(column.label), null)
      } else {
        // Header node: inserted dynamically (reactive to signals — select-all checked state etc.); plain text columns unaffected.
        // resolveSlot normalizes VuiChildren (strings/numbers/arrays/nodes) into a mountable node
        insertDynamic(cell, null, () => resolveSlot(typeof head === 'function' ? head() : head))
      }
      insertBefore(row, cell, null)
    }
    insertBefore(parent, row, anchor)
  })
}

function resolveTableState<Row>(props: TableProps<Row>): TableState {
  const explicit = readProp<TableState | undefined>(props, 'state', undefined)
  if (explicit !== undefined) return explicit
  const rows = readProp<readonly Row[]>(props, 'rows', [])
  return rows.length === 0 ? 'empty' : 'ok'
}

function createTableBody<Row>(props: TableProps<Row>): VobsNode {
  const state = resolveTableState(props)
  const columns = readProp<readonly TableColumn<Row>[]>(props, 'columns', [])
  if (state === 'loading') return createSkeletonRows(props, columns.length)
  if (state === 'error') return createErrorRow(props, columns.length)
  const rows = readProp<readonly Row[]>(props, 'rows', [])
  if (rows.length === 0) return createEmptyRow(props, columns.length)

  return createFragment((parent, anchor) => {
    for (let index = 0; index < rows.length; index++) {
      insertBefore(parent, createTableRow(rows[index], index, columns, props), anchor)
    }
  })
}

function createSkeletonRows<Row>(props: TableProps<Row>, columnCount: number): VobsNode {
  const count = Math.max(1, readProp(props, 'loadingRows', 5))
  const rowHeight = readProp<number | undefined>(props, 'rowHeight', undefined)
  return createFragment((parent, anchor) => {
    for (let index = 0; index < count; index++) {
      const row = createElement('tr')
      setAttribute(row, 'data-loading', 'true')
      if (rowHeight !== undefined) setAttribute(row, 'style', `height:${rowHeight}px`)
      for (let ci = 0; ci < columnCount; ci++) {
        const cell = createElement('td')
        const bar = createElement('span')
        setAttribute(bar, 'class', 'vui-table__skeleton')
        // Skeleton widths are staggered per row/cell so it reads as "loading" rather than a row of equal gray blocks
        setAttribute(bar, 'style', `width:${50 + ((index * 7 + ci * 13) % 40)}%`)
        insertBefore(cell, bar, null)
        insertBefore(row, cell, null)
      }
      insertBefore(parent, row, anchor)
    }
  })
}

function createErrorRow<Row>(props: TableProps<Row>, columnCount: number): VobsNode {
  const row = createElement('tr')
  const cell = createElement('td')
  setAttribute(cell, 'colspan', String(Math.max(1, columnCount)))
  const wrap = createElement('div')
  setAttribute(wrap, 'class', 'vui-table__error')
  if (hasProp(props, 'error')) {
    insertDynamic(wrap, null, () => resolveSlot(Reflect.get(props, 'error')))
  } else {
    insertBefore(wrap, createText('Failed to load data'), null)
  }
  const onRetry = readProp<(() => void) | undefined>(props, 'onRetry', undefined)
  if (onRetry) {
    const button = createElement('button')
    setAttribute(button, 'type', 'button')
    setAttribute(button, 'class', 'vui-table__retry')
    insertBefore(button, createText('Retry'), null)
    addEventListener(button, 'click', () => onRetry())
    insertBefore(wrap, button, null)
  }
  insertBefore(cell, wrap, null)
  insertBefore(row, cell, null)
  return row
}

function createTableRow<Row>(
  row: Row,
  index: number,
  columns: readonly TableColumn<Row>[],
  props: TableProps<Row>
): VobsNode {
  const tableRow = createElement('tr')
  const rowKey = readProp<TableProps<Row>['rowKey']>(props, 'rowKey', undefined)
  if (rowKey) setOptionalAttribute(tableRow, 'data-row-key', rowKey(row, index))
  const rowHeight = readProp<number | undefined>(props, 'rowHeight', undefined)
  if (rowHeight !== undefined) setAttribute(tableRow, 'style', `height:${rowHeight}px`)
  const rowActive = readProp<TableProps<Row>['rowActive']>(props, 'rowActive', undefined)
  if (rowActive?.(row, index)) setAttribute(tableRow, 'data-active', 'true')

  for (const column of columns) {
    const cell = createElement('td')
    setAttribute(cell, 'data-column-id', column.id)
    applyAlignment(cell, column.align)
    insertDynamic(cell, null, () => {
      const value = column.render
        ? column.render(row, index)
        : column.key === undefined
          ? undefined
          : readRowValue(row, column.key)
      return resolveSlot(value)
    })
    insertBefore(tableRow, cell, null)
  }

  const onRowClick = readProp<TableProps<Row>['onRowClick']>(props, 'onRowClick', undefined)
  if (onRowClick) {
    setProperty(tableRow, 'tabIndex', 0)
    setAttribute(tableRow, 'data-clickable', 'true')
    addEventListener(tableRow, 'click', () => onRowClick(row, index))
  }
  return tableRow
}

function createEmptyRow<Row>(props: TableProps<Row>, columnCount: number): VobsNode {
  const row = createElement('tr')
  const cell = createElement('td')
  setAttribute(cell, 'colspan', String(Math.max(1, columnCount)))
  if (hasProp(props, 'empty')) {
    insertDynamic(cell, null, () => resolveSlot(Reflect.get(props, 'empty')))
  } else {
    insertBefore(cell, createText('No data'), null)
  }
  insertBefore(row, cell, null)
  return row
}

function applyAlignment(cell: Element, align: TableAlign | undefined): void {
  if (align === 'end') {
    setAttribute(cell, 'class', 'num')
    setAttribute(cell, 'data-align', 'end')
  } else if (align === 'center') {
    setAttribute(cell, 'data-align', 'center')
  }
}

function readRowValue<Row>(row: Row, key: keyof Row): unknown {
  if (row === null || row === undefined) return undefined
  return Reflect.get(row as object, key)
}
