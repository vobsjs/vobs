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
import type { VuiChildren, VuiCommonProps } from './types'

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly icon?: VobsNode | (() => VobsNode | null | undefined)
  readonly badge?: VuiChildren
  readonly href?: string
  readonly target?: string
  readonly rel?: string
  readonly active?: boolean
  readonly disabled?: boolean
}

export interface NavGroup {
  readonly id?: string
  readonly title?: string
  readonly items: readonly NavItem[]
}

export interface NavListProps extends VuiCommonProps {
  readonly groups?: readonly NavGroup[]
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (id: string, event: MouseEvent) => void
}

export function NavList(props: NavListProps = {}): VobsNode {
  const root = createElement('nav')
  const internalValue = state<string | undefined>(undefined)

  bindClassList(root, props, () => ['vui-navlist'])
  bindCommonAttributes(root, props, ['groups', 'value', 'defaultValue', 'onChange'])
  insertDynamic(root, null, () => createNavGroups(props, internalValue))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createNavGroups(
  props: NavListProps,
  internalValue: { value: string | undefined }
): VobsNode {
  const groups = readProp<readonly NavGroup[]>(props, 'groups', [])
  const selected = activeId(props, groups, internalValue)
  return createFragment((parent, anchor) => {
    for (const group of groups) {
      const groupRoot = createElement('div')
      setAttribute(groupRoot, 'class', 'vui-navlist__group')
      setOptionalAttribute(groupRoot, 'data-nav-group-id', group.id)

      if (group.title !== undefined) {
        const title = createElement('div')
        setAttribute(title, 'class', 'vui-navlist__group-title')
        insertBefore(title, createText(group.title), null)
        insertBefore(groupRoot, title, null)
      }

      for (const item of group.items) {
        insertBefore(groupRoot, createNavItem(item, props, selected, internalValue), null)
      }
      insertBefore(parent, groupRoot, anchor)
    }
  })
}

function createNavItem(
  item: NavItem,
  props: NavListProps,
  selected: string | undefined,
  internalValue: { value: string | undefined }
): VobsNode {
  const active = item.id === selected
  const element = createElement(item.href === undefined ? 'button' : 'a')
  setAttribute(element, 'class', `vui-navlist__item${active ? ' is-active' : ''}`)
  if (item.href !== undefined) setAttribute(element, 'role', 'link')
  setOptionalAttribute(element, 'data-nav-id', item.id)
  if (item.href !== undefined) {
    setAttribute(element, 'href', item.href)
    setOptionalAttribute(element, 'target', item.target)
    setOptionalAttribute(element, 'rel', item.rel)
  } else {
    setAttribute(element, 'type', 'button')
  }
  if (active) setAttribute(element, 'aria-current', 'page')
  if (item.disabled === true) {
    setAttribute(element, 'aria-disabled', 'true')
    setProperty(element, 'tabIndex', -1)
    if (item.href === undefined) setProperty(element, 'disabled', true)
  }

  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-navlist__icon')
    mountSlot(icon, item, 'icon')
    insertBefore(element, icon, null)
  }

  const label = createElement('span')
  setAttribute(label, 'class', 'vui-navlist__label')
  insertBefore(label, createText(item.label), null)
  insertBefore(element, label, null)

  if (item.badge !== undefined) {
    const badge = createElement('span')
    setAttribute(badge, 'class', 'vui-navlist__badge')
    mountSlot(badge, item, 'badge')
    insertBefore(element, badge, null)
  }

  addEventListener(element, 'click', event => {
    if (item.disabled === true) {
      event.preventDefault?.()
      return
    }
    if (readProp<string | undefined>(props, 'value', undefined) === undefined) internalValue.value = item.id
    const handler = readProp<unknown>(props, 'onChange', undefined)
    if (typeof handler === 'function') (handler as NavListProps['onChange'])!(item.id, event as MouseEvent)
  })
  return element
}

function activeId(
  props: NavListProps,
  groups: readonly NavGroup[],
  internalValue: { value: string | undefined }
): string | undefined {
  const controlled = readProp<string | undefined>(props, 'value', undefined)
  if (controlled !== undefined) return controlled
  if (internalValue.value !== undefined) return internalValue.value
  const defaultValue = readProp<string | undefined>(props, 'defaultValue', undefined)
  if (defaultValue !== undefined) return defaultValue
  for (const group of groups) {
    const active = group.items.find(item => item.active === true)
    if (active) return active.id
  }
  return undefined
}
