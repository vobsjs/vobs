import { effect, state, untrack, type Signal } from '@vobs/reactivity'
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
  bindText,
  createDefaultColumnSettings,
  hasProp,
  isColumnWidthValue,
  normalizeColumnSettings,
  orderColumns,
  readProp,
  resolveSlot
} from './utils'
import type {
  DataTableColumn,
  DataTableColumnSettings,
  KitColumnSettingsProps
} from './types'

export function KitColumnSettings<Row = Record<string, unknown>>(
  props: KitColumnSettingsProps<Row> = {}
): VobsNode {
  const root = createElement('details')
  const summary = createElement('summary')
  const panel = createElement('div')
  const columns = readColumns(props)
  const internalSettings = state(untrack(() => initialSettings(props, columns)))
  const panelOpen = state(false)

  untrack(() => restoreSettings(props, columns, internalSettings))

  effect(() => {
    currentSettings(props, internalSettings, columns)
    if (panelOpen.value) setProperty(root, 'open', true)
  })

  bindClassList(root, props, () => ['vobs-column-settings'])
  bindCommonAttributes(root, props, [
    'columns',
    'settings',
    'persistence',
    'visibleColumnIds',
    'trigger',
    'label',
    'closeLabel',
    'resetLabel',
    'onChange',
    'onSettingsChange',
    'onReset',
    'onPersistenceError'
  ])
  setAttribute(summary, 'class', 'vobs-column-settings__trigger')
  setAttribute(panel, 'class', 'vobs-column-settings__panel')
  setAttribute(panel, 'role', 'group')
  addEventListener(summary, 'click', event => {
    event.preventDefault()
    panelOpen.value = !(root as HTMLDetailsElement).open
    setProperty(root, 'open', panelOpen.value)
  })

  if (hasProp(props, 'trigger')) {
    insertDynamic(summary, null, () => resolveSlot(readProp(props, 'trigger', undefined)))
  } else {
    const label = createText('')
    bindText(label, () => readProp(props, 'label', 'Columns'))
    insertBefore(summary, label, null)
  }

  insertDynamic(panel, null, () => createColumnOptions(props, internalSettings, columns, root))
  insertBefore(root, summary, null)
  insertBefore(root, panel, null)
  return root
}

function createColumnOptions<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  root: Element
): VobsNode {
  const settings = currentSettings(props, internalSettings, columns)
  return createFragment((parent, anchor) => {
    const reset = createElement('button')
    const resetLabel = createText('')
    setAttribute(reset, 'type', 'button')
    setAttribute(reset, 'class', 'vobs-column-settings__reset')
    bindText(resetLabel, () => readProp(props, 'resetLabel', 'Reset columns'))
    addEventListener(reset, 'click', event => {
      event.preventDefault()
      event.stopPropagation()
      resetSettings(props, internalSettings, columns, root)
    })
    insertBefore(reset, resetLabel, null)
    insertBefore(parent, reset, anchor)

    const visibility = createElement('div')
    setAttribute(visibility, 'class', 'vobs-column-settings__visibility')
    for (const column of columns) {
      insertBefore(visibility, createVisibilityOption(props, internalSettings, columns, column), null)
    }
    insertBefore(parent, visibility, anchor)

    const layout = createElement('div')
    setAttribute(layout, 'class', 'vobs-column-settings__layout')
    const ordered = orderColumns(columns, settings.columnOrder)
    for (const [index, column] of ordered.entries()) {
      insertBefore(layout, createLayoutOption(
        props,
        internalSettings,
        columns,
        column,
        root,
        index === 0,
        index === ordered.length - 1
      ), null)
    }
    insertBefore(parent, layout, anchor)
  })
}

function createVisibilityOption<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  column: DataTableColumn<Row>
): VobsNode {
  const option = createElement('label')
  const input = createElement('input') as HTMLInputElement
  const text = createText(column.label)
  const settings = currentSettings(props, internalSettings, columns)
  setAttribute(option, 'class', 'vobs-column-settings__option')
  setAttribute(input, 'type', 'checkbox')
  setProperty(input, 'checked', settings.visibleColumnIds.includes(column.id))
  setProperty(input, 'disabled', settings.visibleColumnIds.length <= 1 && input.checked)
  addEventListener(input, 'change', () => {
    const current = currentSettings(props, internalSettings, columns)
    const visible = new Set(current.visibleColumnIds)
    if (input.checked) visible.add(column.id)
    else if (visible.size > 1) visible.delete(column.id)
    const ordered = orderColumns(columns, current.columnOrder)
    const nextIds = ordered.filter(candidate => visible.has(candidate.id)).map(candidate => candidate.id)
    commitSettings(props, internalSettings, columns, {
      ...current,
      visibleColumnIds: nextIds
    })
  })
  insertBefore(option, input, null)
  insertBefore(option, text, null)
  return option
}

function createLayoutOption<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  column: DataTableColumn<Row>,
  root: Element,
  isFirst: boolean,
  isLast: boolean
): VobsNode {
  const option = createElement('div')
  const label = createElement('span')
  const controls = createElement('div')
  const up = createMoveButton('up', column.label, isFirst)
  const down = createMoveButton('down', column.label, isLast)
  const width = createElement('input') as HTMLInputElement
  const current = currentSettings(props, internalSettings, columns)
  const configuredWidth = current.columnWidths[column.id] ?? column.width

  setAttribute(option, 'class', 'vobs-column-settings__layout-option')
  setAttribute(option, 'data-column-id', column.id)
  setAttribute(label, 'class', 'vobs-column-settings__layout-label')
  setProperty(label, 'textContent', column.label)
  setAttribute(controls, 'class', 'vobs-column-settings__layout-controls')
  setAttribute(width, 'type', 'text')
  setAttribute(width, 'class', 'vobs-column-settings__width')
  setAttribute(width, 'placeholder', 'auto')
  setAttribute(width, 'aria-label', `${column.label} width`)
  setProperty(width, 'value', displayWidth(configuredWidth))

  addEventListener(up, 'click', event => {
    event.preventDefault()
    event.stopPropagation()
    moveColumn(props, internalSettings, columns, column.id, -1, root)
  })
  addEventListener(down, 'click', event => {
    event.preventDefault()
    event.stopPropagation()
    moveColumn(props, internalSettings, columns, column.id, 1, root)
  })
  const commitWidth = (): void => {
    const value = width.value.trim()
    const currentSettingsValue = currentSettings(props, internalSettings, columns)
    const currentWidth = displayWidth(currentSettingsValue.columnWidths[column.id] ?? column.width)
    if (value === currentWidth) return
    if (value && !isColumnWidthValue(value)) {
      width.value = currentWidth
      return
    }
    const nextWidths = { ...currentSettingsValue.columnWidths }
    if (value) nextWidths[column.id] = value
    else delete nextWidths[column.id]
    commitSettings(props, internalSettings, columns, {
      ...currentSettingsValue,
      columnWidths: nextWidths
    })
  }
  addEventListener(width, 'change', commitWidth)
  addEventListener(width, 'blur', commitWidth)
  addEventListener(width, 'keydown', event => {
    if ((event as KeyboardEvent).key !== 'Enter') return
    event.preventDefault()
    commitWidth()
  })

  insertBefore(controls, up, null)
  insertBefore(controls, down, null)
  insertBefore(controls, width, null)
  insertBefore(option, label, null)
  insertBefore(option, controls, null)
  return option
}

function createMoveButton(direction: 'up' | 'down', columnLabel: string, disabled: boolean): Element {
  const button = createElement('button')
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', `vobs-column-settings__move vobs-column-settings__move--${direction}`)
  setAttribute(button, 'aria-label', `Move ${columnLabel} ${direction}`)
  setAttribute(button, 'title', `Move ${columnLabel} ${direction}`)
  setProperty(button, 'disabled', disabled)
  insertBefore(button, createText(direction === 'up' ? '↑' : '↓'), null)
  return button
}

function moveColumn<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  columnId: string,
  offset: -1 | 1,
  root: Element
): void {
  const current = currentSettings(props, internalSettings, columns)
  const order = [...current.columnOrder]
  const index = order.indexOf(columnId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= order.length) return
  ;[order[index], order[target]] = [order[target], order[index]]
  commitSettings(props, internalSettings, columns, { ...current, columnOrder: order })
  reopenPanel(root)
}

function resetSettings<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  root: Element
): void {
  const persistence = readProp<KitColumnSettingsProps<Row>['persistence'] | undefined>(props, 'persistence', undefined)
  let cleared = false
  if (persistence?.reset) {
    try {
      persistence.reset()
      cleared = true
    } catch (error) {
      reportPersistenceError(props, error)
    }
  }
  const defaults = createDefaultColumnSettings(columns)
  commitSettings(props, internalSettings, columns, defaults, !persistence || !cleared)
  reopenPanel(root)
  readProp<KitColumnSettingsProps<Row>['onReset'] | undefined>(props, 'onReset', undefined)?.()
}

function commitSettings<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[],
  settings: DataTableColumnSettings,
  persist = true
): void {
  const normalized = normalizeColumnSettings(columns, settings)
  if (!isControlled(props)) internalSettings.value = normalized
  if (persist) saveSettings(props, normalized)
  readProp<KitColumnSettingsProps<Row>['onSettingsChange'] | undefined>(props, 'onSettingsChange', undefined)?.(normalized)
  readProp<KitColumnSettingsProps<Row>['onChange'] | undefined>(props, 'onChange', undefined)?.(normalized.visibleColumnIds)
}

function initialSettings<Row>(
  props: KitColumnSettingsProps<Row>,
  columns: readonly DataTableColumn<Row>[]
): DataTableColumnSettings {
  const settings = readProp<DataTableColumnSettings | undefined>(props, 'settings', undefined)
  if (settings !== undefined) return normalizeColumnSettings(columns, settings)
  return normalizeColumnSettings(
    columns,
    undefined,
    readProp<readonly string[] | undefined>(props, 'visibleColumnIds', undefined)
  )
}

function restoreSettings<Row>(
  props: KitColumnSettingsProps<Row>,
  columns: readonly DataTableColumn<Row>[],
  internalSettings: Signal<DataTableColumnSettings>
): void {
  if (isControlled(props)) return
  const persistence = readProp<KitColumnSettingsProps<Row>['persistence'] | undefined>(props, 'persistence', undefined)
  if (!persistence) return
  try {
    const stored = persistence.load()
    if (stored) internalSettings.value = normalizeColumnSettings(columns, stored)
  } catch (error) {
    reportPersistenceError(props, error)
  }
}

function currentSettings<Row>(
  props: KitColumnSettingsProps<Row>,
  internalSettings: Signal<DataTableColumnSettings>,
  columns: readonly DataTableColumn<Row>[]
): DataTableColumnSettings {
  const external = readProp<DataTableColumnSettings | undefined>(props, 'settings', undefined)
  if (external !== undefined) return normalizeColumnSettings(columns, external)
  const visibleColumnIds = readProp<readonly string[] | undefined>(props, 'visibleColumnIds', undefined)
  if (visibleColumnIds !== undefined) {
    return normalizeColumnSettings(columns, {
      ...internalSettings.value,
      visibleColumnIds
    })
  }
  return normalizeColumnSettings(columns, internalSettings.value)
}

function saveSettings<Row>(props: KitColumnSettingsProps<Row>, settings: DataTableColumnSettings): void {
  const persistence = readProp<KitColumnSettingsProps<Row>['persistence'] | undefined>(props, 'persistence', undefined)
  if (!persistence) return
  try {
    persistence.save(settings)
  } catch (error) {
    reportPersistenceError(props, error)
  }
}

function readColumns<Row>(props: KitColumnSettingsProps<Row>): readonly DataTableColumn<Row>[] {
  return readProp<readonly DataTableColumn<Row>[]>(props, 'columns', [])
}

function displayWidth(value: string | number | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'number' ? `${value}px` : value
}

function isControlled<Row>(props: KitColumnSettingsProps<Row>): boolean {
  return isProvided(props, 'settings') || isProvided(props, 'visibleColumnIds')
}

function isProvided(props: object, name: string): boolean {
  return hasProp(props, name) && Reflect.get(props, name) !== undefined
}

function reportPersistenceError<Row>(props: KitColumnSettingsProps<Row>, error: unknown): void {
  readProp<KitColumnSettingsProps<Row>['onPersistenceError'] | undefined>(props, 'onPersistenceError', undefined)?.(error)
}

function reopenPanel(root: Element): void {
  setTimeout(() => {
    setProperty(root, 'open', true)
  }, 0)
}
