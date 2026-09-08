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

export interface ActivityRailItem {
  readonly id?: string
  readonly label?: string
  readonly icon?: VuiChildren
  readonly divider?: boolean
  readonly spacer?: boolean
  readonly disabled?: boolean
}

export interface ActivityRailProps extends VuiCommonProps {
  readonly items?: readonly ActivityRailItem[]
  readonly value?: string
  readonly defaultValue?: string
  readonly onChange?: (id: string, event: MouseEvent) => void
}

export function ActivityRail(props: ActivityRailProps = {}): VobsNode {
  const root = createElement('nav')
  const internalValue = state<string | undefined>(undefined)
  bindClassList(root, props, () => ['vui-activityrail'])
  bindCommonAttributes(root, props, ['items', 'value', 'defaultValue', 'onChange'])
  bindUserStyle(root, props)
  if (!hasProp(props, 'aria-label')) setAttribute(root, 'aria-label', 'Activity')
  if (hasProp(props, 'items')) insertDynamic(root, null, () => createActivityItems(props, internalValue))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createActivityItems(
  props: ActivityRailProps,
  internalValue: { value: string | undefined }
): VobsNode {
  const items = readProp<readonly ActivityRailItem[]>(props, 'items', [])
  const selected = activeId(props, items, internalValue)
  return createFragment((parent, anchor) => {
    for (const item of items) {
      if (item.divider === true) {
        const divider = createElement('div')
        setAttribute(divider, 'class', 'vui-activityrail__divider')
        setAttribute(divider, 'role', 'separator')
        insertBefore(parent, divider, anchor)
        continue
      }
      if (item.spacer === true) {
        const spacer = createElement('span')
        setAttribute(spacer, 'class', 'vui-activityrail__spacer')
        insertBefore(parent, spacer, anchor)
        continue
      }
      insertBefore(parent, createActivityButton(item, props, selected, internalValue), anchor)
    }
  })
}

function createActivityButton(
  item: ActivityRailItem,
  props: ActivityRailProps,
  selected: string | undefined,
  internalValue: { value: string | undefined }
): VobsNode {
  const button = createElement('button')
  const active = item.id !== undefined && item.id === selected
  setAttribute(button, 'class', `vui-activityrail__btn${active ? ' is-active' : ''}`)
  setAttribute(button, 'type', 'button')
  setOptionalAttribute(button, 'aria-label', item.label)
  setOptionalAttribute(button, 'title', item.label)
  setAttribute(button, 'aria-pressed', active ? 'true' : 'false')
  if (item.disabled === true) {
    setProperty(button, 'disabled', true)
    setAttribute(button, 'aria-disabled', 'true')
  }

  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-activityrail__icon')
    mountSlot(icon, item, 'icon')
    insertBefore(button, icon, null)
  } else if (item.label !== undefined) {
    insertBefore(button, createText(item.label), null)
  }

  addEventListener(button, 'click', event => {
    if (item.disabled === true || item.id === undefined) return
    if (readProp<string | undefined>(props, 'value', undefined) === undefined) internalValue.value = item.id
    const handler = readProp<unknown>(props, 'onChange', undefined)
    if (typeof handler === 'function') (handler as ActivityRailProps['onChange'])!(item.id, event as MouseEvent)
  })
  return button
}

function activeId(
  props: ActivityRailProps,
  items: readonly ActivityRailItem[],
  internalValue: { value: string | undefined }
): string | undefined {
  const controlled = readProp<string | undefined>(props, 'value', undefined)
  if (controlled !== undefined) return controlled
  if (internalValue.value !== undefined) return internalValue.value
  const defaultValue = readProp<string | undefined>(props, 'defaultValue', undefined)
  if (defaultValue !== undefined) return defaultValue
  return items.find(item => item.id !== undefined)?.id
}
