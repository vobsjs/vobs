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

export interface TableColumn<Row = Record<string, unknown>> {
  readonly id: string
  readonly label: string
  readonly key?: keyof Row
  readonly render?: (row: Row, index: number) => VuiChildren
  readonly align?: TableAlign
}

export interface TableProps<Row = Record<string, unknown>> extends VuiCommonProps {
  readonly columns?: readonly TableColumn<Row>[]
  readonly rows?: readonly Row[]
  readonly caption?: string
  readonly empty?: VuiChildren
  readonly rowKey?: (row: Row, index: number) => unknown
  readonly onRowClick?: (row: Row, index: number) => void
}

export function Table<Row = Record<string, unknown>>(props?: TableProps<Row>): VobsNode
export function Table(props?: TableProps<any>): VobsNode
export function Table<Row = Record<string, unknown>>(props: TableProps<Row> = {}): VobsNode {
  const root = createElement('table')
  const head = createElement('thead')
  const body = createElement('tbody')

  bindClassList(root, props, () => ['vui-table'])
  bindCommonAttributes(root, props, ['columns', 'rows', 'caption', 'empty', 'rowKey', 'onRowClick'])
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
}

export function TablePanel<Row = Record<string, unknown>>(props?: TablePanelProps<Row>): VobsNode
export function TablePanel(props?: TablePanelProps<any>): VobsNode
export function TablePanel<Row = Record<string, unknown>>(props: TablePanelProps<Row> = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-tablepanel'])
  bindCommonAttributes(root, props, ['columns', 'rows', 'empty', 'footer', 'rowKey', 'onRowClick'])
  bindUserStyle(root, props)

  const table = Table<Row>({
    get columns() { return readProp<readonly TableColumn<Row>[]>(props, 'columns', []) },
    get rows() { return readProp<readonly Row[]>(props, 'rows', []) },
    get empty() { return readProp<VuiChildren | undefined>(props, 'empty', undefined) },
    get rowKey() { return readProp<TablePanelProps<Row>['rowKey']>(props, 'rowKey', undefined) },
    get onRowClick() { return readProp<TablePanelProps<Row>['onRowClick']>(props, 'onRowClick', undefined) }
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
      insertBefore(cell, createText(column.label), null)
      insertBefore(row, cell, null)
    }
    insertBefore(parent, row, anchor)
  })
}

function createTableBody<Row>(props: TableProps<Row>): VobsNode {
  const columns = readProp<readonly TableColumn<Row>[]>(props, 'columns', [])
  const rows = readProp<readonly Row[]>(props, 'rows', [])
  if (rows.length === 0) return createEmptyRow(props, columns.length)

  return createFragment((parent, anchor) => {
    for (let index = 0; index < rows.length; index++) {
      insertBefore(parent, createTableRow(rows[index], index, columns, props), anchor)
    }
  })
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
