import { effect } from '@vobs/reactivity'
import {
  createFragment,
  createText,
  insertBefore,
  setAttribute,
  setTextContent,
  type VobsNode
} from '@vobs/vobs'
import type { DataTableColumn, DataTableColumnSettings } from './types'
export function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

export function hasProp(props: object, name: string): boolean {
  return name in props
}

export function bindClassList(root: Element, props: object, classes: () => readonly (string | undefined)[]): void {
  effect(() => {
    const userClasses = [readString(props, 'class'), readString(props, 'className')]
    setAttribute(root, 'class', [...classes(), ...userClasses].filter(Boolean).join(' '))
  })
}

export function bindCommonAttributes(root: Element, props: object, skip: readonly string[]): void {
  const ignored = new Set([...skip, 'class', 'className', 'style', 'children'])
  effect(() => {
    for (const name of Object.keys(props)) {
      if (ignored.has(name) || name.startsWith('on')) continue
      if (name !== 'id' && name !== 'title' && name !== 'role' && name !== 'tabIndex'
        && !name.startsWith('aria-') && !name.startsWith('data-')) continue
      const value = Reflect.get(props, name)
      if (value === undefined || value === null || value === false) removeAttribute(root, normalizeAttributeName(name))
      else setAttribute(root, normalizeAttributeName(name), String(value))
    }
  })
}

export function bindStyle(root: Element, props: object, internal: () => string = () => ''): void {
  effect(() => {
    const value = [internal(), readString(props, 'style')].filter(Boolean).join('; ')
    if (value) setAttribute(root, 'style', value)
    else removeAttribute(root, 'style')
  })
}

export function bindText(node: Text, read: () => unknown): void {
  effect(() => setTextContent(node, String(read() ?? '')))
}

export function resolveSlot(value: unknown): VobsNode | null {
  const resolved = typeof value === 'function' ? value() : value
  if (resolved === undefined || resolved === null) return null
  if (typeof resolved === 'string' || typeof resolved === 'number') return createText(String(resolved))
  if (Array.isArray(resolved)) {
    return createFragment((parent, anchor) => {
      for (const child of resolved) {
        const node = resolveSlot(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return resolved as VobsNode
}

export function setOptionalAttribute(node: Element, name: string, value: unknown): void {
  if (value === undefined || value === null || value === false || value === '') removeAttribute(node, name)
  else setAttribute(node, name, String(value))
}

export function normalizePixels(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

export function createDefaultColumnSettings<Row>(
  columns: readonly DataTableColumn<Row>[],
  visibleColumnIds?: readonly string[]
): DataTableColumnSettings {
  const columnOrder = columns.map(column => column.id)
  const requested = new Set(visibleColumnIds ?? columns
    .filter(column => column.visible !== false)
    .map(column => column.id))
  const visible = columnOrder.filter(id => requested.has(id)
    && columns.some(column => column.id === id && column.visible !== false))
  if (visible.length === 0) {
    const fallback = columns.find(column => column.visible !== false)
    if (fallback) visible.push(fallback.id)
  }
  return { visibleColumnIds: visible, columnOrder, columnWidths: {} }
}

export function normalizeColumnSettings<Row>(
  columns: readonly DataTableColumn<Row>[],
  settings?: Partial<DataTableColumnSettings> | null,
  visibleColumnIds?: readonly string[]
): DataTableColumnSettings {
  const fallback = createDefaultColumnSettings(columns, visibleColumnIds)
  const knownIds = new Set(fallback.columnOrder)
  const configuredOrder = Array.isArray(settings?.columnOrder) ? settings.columnOrder : undefined
  const order = uniqueKnownIds(configuredOrder, knownIds)
  for (const id of fallback.columnOrder) {
    if (!order.includes(id)) order.push(id)
  }

  const configuredVisible = Array.isArray(settings?.visibleColumnIds) ? settings.visibleColumnIds : undefined
  const requestedVisible = new Set(configuredVisible ?? fallback.visibleColumnIds)
  const visible = order.filter(id => requestedVisible.has(id)
    && columns.some(column => column.id === id && column.visible !== false))
  if (visible.length === 0) {
    const fallbackVisible = order.find(id => columns.some(column => column.id === id && column.visible !== false))
    if (fallbackVisible) visible.push(fallbackVisible)
  }

  const columnWidths: Record<string, string | number> = {}
  const configuredWidths = settings?.columnWidths && typeof settings.columnWidths === 'object'
    && !Array.isArray(settings.columnWidths) ? settings.columnWidths : {}
  for (const [id, width] of Object.entries(configuredWidths)) {
    if (knownIds.has(id) && isColumnWidthValue(width)) columnWidths[id] = width
  }
  return { visibleColumnIds: visible, columnOrder: order, columnWidths }
}

export function orderColumns<Row>(
  columns: readonly DataTableColumn<Row>[],
  columnOrder?: readonly string[]
): readonly DataTableColumn<Row>[] {
  if (!columnOrder || columnOrder.length === 0) return columns
  const byId = new Map(columns.map(column => [column.id, column]))
  const ordered: DataTableColumn<Row>[] = []
  const seen = new Set<string>()
  for (const id of columnOrder) {
    const column = byId.get(id)
    if (column && !seen.has(id)) {
      ordered.push(column)
      seen.add(id)
    }
  }
  for (const column of columns) {
    if (!seen.has(column.id)) ordered.push(column)
  }
  return ordered
}

export function isColumnWidthValue(value: unknown): value is string | number {
  return typeof value === 'number'
    ? Number.isFinite(value) && value > 0
    : typeof value === 'string' && value.trim().length > 0 && !/[;{}]/u.test(value)
}

function uniqueKnownIds(values: readonly string[] | undefined, knownIds: ReadonlySet<string>): string[] {
  const result: string[] = []
  for (const id of values ?? []) {
    if (knownIds.has(id) && !result.includes(id)) result.push(id)
  }
  return result
}

function readString(props: object, name: string): string | undefined {
  const value = Reflect.get(props, name)
  return typeof value === 'string' ? value : undefined
}

function normalizeAttributeName(name: string): string {
  return name === 'tabIndex' ? 'tabindex' : name
}

function removeAttribute(node: Element, name: string): void {
  node.removeAttribute(name)
}
