import { state } from '@vobs/reactivity'
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
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type FileTreeItemKind = 'file' | 'folder'

export interface FileTreeItem {
  readonly id: string
  readonly label: string
  readonly kind?: FileTreeItemKind
  readonly icon?: VuiChildren
  readonly chevron?: VuiChildren
  readonly children?: readonly FileTreeItem[]
  readonly expanded?: boolean
  readonly active?: boolean
  readonly disabled?: boolean
}

export interface FileTreeProps extends VuiCommonProps {
  readonly items?: readonly FileTreeItem[]
  readonly value?: string
  readonly defaultValue?: string
  readonly expanded?: readonly string[]
  readonly defaultExpanded?: readonly string[]
  readonly onSelect?: (id: string, event: MouseEvent) => void
  readonly onToggle?: (id: string, expanded: boolean, event: MouseEvent) => void
}

interface VisibleFileTreeItem {
  readonly item: FileTreeItem
  readonly depth: number
  readonly expanded: boolean
}

export function FileTree(props: FileTreeProps = {}): VobsNode {
  const items = readProp<readonly FileTreeItem[]>(props, 'items', [])
  const internalExpanded = state<readonly string[]>(initialExpanded(props, items))
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-filetree'])
  bindCommonAttributes(root, props, [
    'items',
    'value',
    'defaultValue',
    'expanded',
    'defaultExpanded',
    'onSelect',
    'onToggle'
  ])
  bindUserStyle(root, props)
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'tree')
  if (!hasProp(props, 'aria-label')) setAttribute(root, 'aria-label', 'Files')
  /*
   * roving tabindex 的落点：键盘焦点所在的行。
   *
   * 原来每行 `tabIndex = 0`（除禁用行）→ 键盘用户按 Tab 要**依次穿过整棵树的每一行**
   * 才能走到后面的内容；而 `role="tree"`/`treeitem` 的标准模型是**整棵树只有一个 Tab 停靠点**，
   * 内部用方向键移动。
   *
   * 用内部状态而不是只看选中项：受控 `value` 不更新的场景下，光看选中会让焦点与 tabindex 分家。
   */
  const focusedId = state<string | undefined>(undefined)
  addEventListener(root, 'keydown', event => {
    const keyboardEvent = event as KeyboardEvent
    const key = keyboardEvent.key
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return
    const rows = [...root.querySelectorAll('[data-file-id]')]
      .filter(row => row.getAttribute('aria-disabled') !== 'true')
    if (rows.length === 0) return
    keyboardEvent.preventDefault?.()
    const current = rows.indexOf((document.activeElement?.closest?.('[data-file-id]') ?? null) as Element)
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? rows.length - 1
        : current < 0
          ? 0
          : Math.max(0, Math.min(rows.length - 1, current + (key === 'ArrowDown' ? 1 : -1)))
    const target = rows[nextIndex]
    const id = target.getAttribute('data-file-id') ?? undefined
    if (id === undefined) return
    // 标准树模式：焦点移动即选中（这里只做选中，不切换文件夹展开）
    if (readProp<string | undefined>(props, 'value', undefined) === undefined) focusedId.value = id
    const onSelect = readProp<unknown>(props, 'onSelect', undefined)
    if (typeof onSelect === 'function') (onSelect as FileTreeProps['onSelect'])!(id, keyboardEvent as unknown as MouseEvent)
    focusRow(root, id)
  })

  insertDynamic(root, null, () => createTreeRows(props, internalExpanded, focusedId))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createTreeRows(
  props: FileTreeProps,
  internalExpanded: { value: readonly string[] },
  focusedId: { value: string | undefined }
): VobsNode {
  const items = readProp<readonly FileTreeItem[]>(props, 'items', [])
  const expanded = new Set(readProp<readonly string[] | undefined>(props, 'expanded', undefined) ?? internalExpanded.value)
  const visible = flattenVisible(items, expanded)
  const selected = activeId(props, items)
  // 整棵树只有一个 Tab 停靠点：优先焦点行，其次选中项，最后第一个可用行。
  const enabled = visible.filter(entry => entry.item.disabled !== true)
  const tabbableId = focusedId.value ?? selected ?? enabled[0]?.item.id
  return createFragment((parent, anchor) => {
    for (const entry of visible) {
      insertBefore(parent, createTreeRow(entry, props, internalExpanded, selected, expanded, tabbableId), anchor)
    }
  })
}

function createTreeRow(
  entry: VisibleFileTreeItem,
  props: FileTreeProps,
  internalExpanded: { value: readonly string[] },
  selected: string | undefined,
  expanded: ReadonlySet<string>,
    tabbableId: string | undefined,
): VobsNode {
  const { item } = entry
  const isFolder = item.kind === 'folder'
  const hasChildren = isFolder && Boolean(item.children?.length)
  const active = item.id === selected
  const row = createElement('div')
  setAttribute(row, 'class', `vui-filetree__row${active ? ' is-active' : ''}`)
  setAttribute(row, 'role', 'treeitem')
  setAttribute(row, 'data-depth', String(entry.depth))
  setAttribute(row, 'data-file-id', item.id)
  setProperty(row, 'tabIndex', item.disabled !== true && item.id === tabbableId ? 0 : -1)
  if (active) setAttribute(row, 'aria-selected', 'true')
  if (isFolder) setAttribute(row, 'aria-expanded', entry.expanded ? 'true' : 'false')
  if (item.disabled === true) setAttribute(row, 'aria-disabled', 'true')

  const chevron = createElement('span')
  setAttribute(chevron, 'class', `vui-filetree__chevron${hasChildren ? '' : ' vui-filetree__chevron--leaf'}`)
  if (hasChildren) {
    if (item.chevron !== undefined) mountSlot(chevron, item, 'chevron')
    else insertBefore(chevron, createText(entry.expanded ? 'v' : '>'), null)
  }
  insertBefore(row, chevron, null)

  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, `class`, `vui-filetree__icon ${fileIconClass(item)}`.trim())
    mountSlot(icon, item, 'icon')
    insertBefore(row, icon, null)
  }

  const label = createElement('span')
  setAttribute(label, 'class', 'vui-filetree__label')
  setOptionalAttribute(label, 'title', item.label)
  insertBefore(label, createText(item.label), null)
  insertBefore(row, label, null)

  addEventListener(row, 'click', event => {
    if (item.disabled === true) return
    if (isFolder && hasChildren) {
      const nextExpanded = !expanded.has(item.id)
      if (readProp<readonly string[] | undefined>(props, 'expanded', undefined) === undefined) {
        const next = new Set(internalExpanded.value)
        if (nextExpanded) next.add(item.id)
        else next.delete(item.id)
        internalExpanded.value = [...next]
      }
      const onToggle = readProp<unknown>(props, 'onToggle', undefined)
      if (typeof onToggle === 'function') {
        (onToggle as FileTreeProps['onToggle'])!(item.id, nextExpanded, event as MouseEvent)
      }
    }
    const onSelect = readProp<unknown>(props, 'onSelect', undefined)
    if (typeof onSelect === 'function') (onSelect as FileTreeProps['onSelect'])!(item.id, event as MouseEvent)
  })
  /*
   * 焦点落在哪一行，哪一行就成为下一个 Tab 停靠点 —— **只改 DOM 属性，不走状态**。
   *
   * 走状态会让 focusedId 变化触发整棵树重建，而重建会立刻把刚刚获得焦点的那个节点换掉，
   * 焦点掉回 body（实测踩到：方向键因此完全失灵，因为事件根本到不了树根）。
   */
  addEventListener(row, 'focus', () => {
    const container = row.parentElement
    if (!container) return
    for (const other of container.querySelectorAll('[data-file-id]')) other.setAttribute('tabindex', '-1')
    row.setAttribute('tabindex', '0')
  })
  addEventListener(row, 'keydown', event => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
    keyboardEvent.preventDefault?.()
    row.dispatchEvent?.(new MouseEvent('click', { bubbles: true }))
  })
  return row
}

/** 把焦点移到目标行：等更新落地后再重新查节点（行会因 tabindex/选中变化而重建）。 */
function focusRow(container: Element, id: string): void {
  queueMicrotask(() => {
    const target = [...container.querySelectorAll('[data-file-id]')]
      .find(element => element.getAttribute('data-file-id') === id)
    if (target instanceof HTMLElement) target.focus()
  })
}
function flattenVisible(
  items: readonly FileTreeItem[],
  expanded: ReadonlySet<string>,
  depth = 0
): VisibleFileTreeItem[] {
  const visible: VisibleFileTreeItem[] = []
  for (const item of items) {
    const folder = item.kind === 'folder'
    const open = folder && expanded.has(item.id)
    visible.push({ item, depth, expanded: open })
    if (open && item.children) visible.push(...flattenVisible(item.children, expanded, depth + 1))
  }
  return visible
}

function initialExpanded(props: FileTreeProps, items: readonly FileTreeItem[]): readonly string[] {
  const ids = new Set(readProp<readonly string[]>(props, 'defaultExpanded', []))
  collectExpanded(items, ids)
  return [...ids]
}

function collectExpanded(items: readonly FileTreeItem[], ids: Set<string>): void {
  for (const item of items) {
    if (item.expanded === true) ids.add(item.id)
    if (item.children) collectExpanded(item.children, ids)
  }
}

function activeId(props: FileTreeProps, items: readonly FileTreeItem[]): string | undefined {
  const controlled = readProp<string | undefined>(props, 'value', undefined)
  if (controlled !== undefined) return controlled
  const defaultValue = readProp<string | undefined>(props, 'defaultValue', undefined)
  if (defaultValue !== undefined) return defaultValue
  return findActive(items)
}

function findActive(items: readonly FileTreeItem[]): string | undefined {
  for (const item of items) {
    if (item.active === true) return item.id
    if (item.children) {
      const nested = findActive(item.children)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function fileIconClass(item: FileTreeItem): string {
  if (item.kind === 'folder') return 'vui-filetree__icon--folder'
  const extension = item.label.slice(item.label.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'ts' || extension === 'tsx') return 'vui-filetree__icon--ts'
  if (extension === 'css' || extension === 'scss') return 'vui-filetree__icon--css'
  if (extension === 'json') return 'vui-filetree__icon--json'
  return ''
}
