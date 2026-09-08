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
import type { VuiChildren, VuiCommonProps } from './types'

export interface MenuItem {
  readonly id?: string
  readonly label?: string
  readonly icon?: VobsNode | (() => VobsNode | null | undefined)
  readonly shortcut?: string
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly divider?: boolean
  readonly content?: VuiChildren
}

export interface MenuProps extends VuiCommonProps {
  readonly items?: readonly MenuItem[]
  readonly onSelect?: (id: string, event: MouseEvent) => void
}

export function Menu(props: MenuProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-menu'])
  bindCommonAttributes(root, props, ['items', 'onSelect'])
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'menu')

  if (hasProp(props, 'items')) {
    insertDynamic(root, null, () => createMenuItems(props))
  }
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export function MenuDivider(props: VuiCommonProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-menu__divider'])
  bindCommonAttributes(root, props)
  setAttribute(root, 'role', 'separator')
  return root
}

function createMenuItems(props: MenuProps): VobsNode {
  const items = readProp<readonly MenuItem[]>(props, 'items', [])
  return createFragment((parent, anchor) => {
    for (const item of items) {
      const node = item.divider === true
        ? createMenuDividerNode(item)
        : createMenuItemNode(item, props)
      insertBefore(parent, node, anchor)
    }
  })
}

function createMenuDividerNode(item: MenuItem): VobsNode {
  const divider = createElement('div')
  setAttribute(divider, 'class', 'vui-menu__divider')
  setAttribute(divider, 'role', 'separator')
  setOptionalAttribute(divider, 'data-menu-item-id', item.id)
  return divider
}

function createMenuItemNode(item: MenuItem, props: MenuProps): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', `vui-menu__item${item.danger === true ? ' vui-menu__item--danger' : ''}`)
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'role', 'menuitem')
  setOptionalAttribute(button, 'data-menu-item-id', item.id)
  if (item.disabled === true) {
    setProperty(button, 'disabled', true)
    setAttribute(button, 'aria-disabled', 'true')
  }

  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-menu__icon')
    mountSlot(icon, item, 'icon')
    insertBefore(button, icon, null)
  }

  if (item.label !== undefined) {
    const label = createElement('span')
    setAttribute(label, 'class', 'vui-menu__label')
    insertBefore(label, createText(item.label), null)
    insertBefore(button, label, null)
  } else if (item.content !== undefined) {
    mountSlot(button, item, 'content')
  }

  if (item.shortcut !== undefined) {
    const shortcut = createElement('span')
    setAttribute(shortcut, 'class', 'vui-menu__shortcut')
    insertBefore(shortcut, createText(item.shortcut), null)
    insertBefore(button, shortcut, null)
  }

  addEventListener(button, 'click', event => {
    if (item.disabled === true || item.id === undefined) return
    const handler = readProp<unknown>(props, 'onSelect', undefined)
    if (typeof handler === 'function') (handler as MenuProps['onSelect'])!(item.id, event as MouseEvent)
  })
  return button
}
