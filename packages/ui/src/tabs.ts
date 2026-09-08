import { effect, state } from '@vobs/reactivity'
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
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface TabItem {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly content?: VuiChildren
}

export interface TabsProps extends VuiCommonProps {
  readonly items: readonly TabItem[]
  readonly value?: string
  readonly variant?: 'default' | 'filled'
  readonly onChange?: (id: string) => void
}

export function Tabs(props: TabsProps): VobsNode {
  const root = createElement('div')
  const tablist = createElement('div')
  const panel = createElement('div')
  const internalValue = state<string | undefined>(undefined)

  bindClassList(root, props, () => ['vui-tabs-root'])
  bindCommonAttributes(root, props, ['items', 'value', 'variant', 'onChange'])
  setAttribute(tablist, 'role', 'tablist')
  effect(() => {
    const variant = readProp<'default' | 'filled'>(props, 'variant', 'default')
    setAttribute(tablist, 'class', `vui-tabs${variant === 'filled' ? ' vui-tabs--filled' : ''}`)
  })
  setAttribute(panel, 'class', 'vui-tabs__panel')

  insertDynamic(tablist, null, () => createTabButtons(props, internalValue))
  insertDynamic(panel, null, () => {
    const item = activeItem(readProp<readonly TabItem[]>(props, 'items', []), activeId(props, internalValue))
    return item?.content === undefined ? null : resolveSlot(item.content)
  })
  insertBefore(root, tablist, null)
  insertBefore(root, panel, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createTabButtons(props: TabsProps, internalValue: { value: string | undefined }): VobsNode {
  const items = readProp<readonly TabItem[]>(props, 'items', [])
  const selected = activeId(props, internalValue)
  return createFragment((parent, anchor) => {
    for (const item of items) {
      const button = createElement('button')
      const isActive = item.id === selected
      setAttribute(button, 'class', `vui-tab${isActive ? ' is-active' : ''}`)
      setAttribute(button, 'role', 'tab')
      setAttribute(button, 'type', 'button')
      setAttribute(button, 'aria-selected', isActive ? 'true' : 'false')
      setAttribute(button, 'data-tab-id', item.id)
      if (item.disabled === true) {
        setAttribute(button, 'aria-disabled', 'true')
        setProperty(button, 'disabled', true)
      }
      insertBefore(button, createText(item.label), null)
      addEventListener(button, 'click', () => {
        if (item.disabled === true) return
        if (readProp<string | undefined>(props, 'value', undefined) === undefined) internalValue.value = item.id
        const onChange = readProp<unknown>(props, 'onChange', undefined)
        if (typeof onChange === 'function') onChange(item.id)
      })
      insertBefore(parent, button, anchor)
    }
  })
}

function activeId(props: TabsProps, internalValue: { value: string | undefined }): string | undefined {
  const controlled = readProp<string | undefined>(props, 'value', undefined)
  if (controlled !== undefined) return controlled
  if (internalValue.value !== undefined) return internalValue.value
  return readProp<readonly TabItem[]>(props, 'items', []).find(item => item.disabled !== true)?.id
}

function activeItem(items: readonly TabItem[], id: string | undefined): TabItem | undefined {
  return items.find(item => item.id === id)
}
