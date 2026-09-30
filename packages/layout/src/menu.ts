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
  hasProp,
  mountSlot,
  readProp,
  setOptionalAttribute
} from './utils'
import type { KitMenuItem, KitMenuProps } from './types'

export function KitMenu(props: KitMenuProps): VobsNode {
  const root = createElement('ul')
  const expanded = state<ReadonlySet<string>>(new Set())

  bindClassList(root, props, () => ['vobs-kit-menu'])
  bindCommonAttributes(root, props, ['items', 'collapsed', 'activeKey', 'onSelect'])
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'menu')
  insertDynamic(root, null, () => createMenuTree(props, expanded))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createMenuTree(
  props: KitMenuProps,
  expanded: { value: ReadonlySet<string> }
): VobsNode {
  const items = readProp<readonly KitMenuItem[]>(props, 'items', [])
  const activeKey = readProp<string | undefined>(props, 'activeKey', undefined)
  const collapsed = readProp(props, 'collapsed', false)

  return createFragment((parent, anchor) => {
    for (const item of items) {
      insertBefore(parent, createMenuItem(item, props, activeKey, collapsed, expanded), anchor)
    }
  })
}

function createMenuItem(
  item: KitMenuItem,
  props: KitMenuProps,
  activeKey: string | undefined,
  collapsed: boolean,
  expanded: { value: ReadonlySet<string> }
): VobsNode {
  const li = createElement('li')
  const children = item.children ?? []
  const hasChildren = children.length > 0
  const active = item.key === activeKey
  const activeDescendant = children.some(child => hasActiveDescendant(child, activeKey))
  const isExpanded = expanded.value.has(item.key) || activeDescendant

  setAttribute(li, 'class', `vobs-kit-menu__item${active || activeDescendant ? ' is-active' : ''}`)
  setOptionalAttribute(li, 'data-menu-key', item.key)

  if (hasChildren) {
    const groupButton = createElement('button')
    setAttribute(groupButton, 'type', 'button')
    setAttribute(groupButton, 'class', 'vobs-kit-menu__link vobs-kit-menu__group-toggle')
    setAttribute(groupButton, 'aria-expanded', isExpanded ? 'true' : 'false')
    if (collapsed) setOptionalAttribute(groupButton, 'title', item.label)
    appendMenuContent(groupButton, item, collapsed)
    addEventListener(groupButton, 'click', () => {
      toggleExpanded(expanded, item.key)
      if (item.href !== undefined) emitSelect(props, item)
    })
    insertBefore(li, groupButton, null)

    if (isExpanded) {
      const nested = createElement('ul')
      setAttribute(nested, 'class', 'vobs-kit-menu__children')
      setAttribute(nested, 'role', 'menu')
      for (const child of children) {
        insertBefore(nested, createMenuItem(child, props, activeKey, collapsed, expanded), null)
      }
      insertBefore(li, nested, null)
    }
  } else {
    const link = createElement(item.href === undefined ? 'button' : 'a')
    setAttribute(link, 'class', 'vobs-kit-menu__link')
    if (item.href === undefined) setAttribute(link, 'type', 'button')
    else {
      setAttribute(link, 'href', item.href)
      setOptionalAttribute(link, 'target', item.target)
      setOptionalAttribute(link, 'rel', item.rel)
    }
    if (active) setAttribute(link, 'aria-current', 'page')
    if (item.disabled === true) {
      setAttribute(link, 'aria-disabled', 'true')
      setProperty(link, 'disabled', true)
    }
    if (collapsed) setOptionalAttribute(link, 'title', item.label)
    appendMenuContent(link, item, collapsed)
    addEventListener(link, 'click', event => {
      if (item.disabled === true) {
        event.preventDefault?.()
        return
      }
      emitSelect(props, item)
    })
    insertBefore(li, link, null)
  }

  return li
}

function appendMenuContent(parent: Element, item: KitMenuItem, collapsed: boolean): void {
  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vobs-kit-menu__icon')
    mountSlot(icon, item, 'icon')
    // 悬浮角标钉在图标右上角（绝对定位于 __icon），展开/收起两态通用；
    // 函数形态在此处调用，信号读取落在 insertDynamic 的追踪作用域内，变化即重建菜单树
    const badgePill = readBadgePill(item)
    if (badgePill !== null) {
      const pill = createElement('span')
      setAttribute(pill, 'class', 'vobs-kit-menu__badge-pill')
      insertBefore(pill, createText(badgePill), null)
      insertBefore(icon, pill, null)
    }
    insertBefore(parent, icon, null)
  }

  const label = createElement('span')
  setAttribute(label, 'class', 'vobs-kit-menu__label')
  insertBefore(label, createText(item.label), null)
  insertBefore(parent, label, null)

  if (item.badge !== undefined && !collapsed) {
    const badge = createElement('span')
    setAttribute(badge, 'class', 'vobs-kit-menu__badge')
    mountSlot(badge, item, 'badge')
    insertBefore(parent, badge, null)
  }

  if (item.children && item.children.length > 0) {
    const expand = createElement('span')
    setAttribute(expand, 'class', 'vobs-kit-menu__expand')
    setAttribute(expand, 'aria-hidden', 'true')
    insertBefore(parent, expand, null)
  }
}

function toggleExpanded(expanded: { value: ReadonlySet<string> }, key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function readBadgePill(item: KitMenuItem): string | null {
  const raw = typeof item.badgePill === 'function' ? item.badgePill() : item.badgePill
  if (raw === undefined || raw === null || raw === 0 || raw === '') return null
  return String(raw)
}

function emitSelect(props: KitMenuProps, item: KitMenuItem): void {
  const handler = readProp<unknown>(props, 'onSelect', undefined)
  if (typeof handler === 'function') (handler as KitMenuProps['onSelect'])!(item.key, item)
}

function hasActiveDescendant(item: KitMenuItem, activeKey: string | undefined): boolean {
  if (item.key === activeKey) return true
  return item.children?.some(child => hasActiveDescendant(child, activeKey)) ?? false
}
