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
import type { KitTabItem, KitTabsProps } from './types'

export function KitTabs(props: KitTabsProps = {}): VobsNode {
  const root = createElement('nav')
  const active = state<string | undefined>(undefined)

  bindClassList(root, props, () => ['vobs-kit-tabs'])
  bindCommonAttributes(root, props, [
    'tabs',
    'items',
    'value',
    'activeKey',
    'closable',
    'onSelect',
    'onChange',
    'onClose'
  ])
  if (!hasProp(props, 'aria-label')) setAttribute(root, 'aria-label', 'Tabs')
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'tablist')
  insertDynamic(root, null, () => createTabItems(props, active))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createTabItems(
  props: KitTabsProps,
  internal: { value: string | undefined }
): VobsNode {
  const tabs = readProp<readonly KitTabItem[]>(props, 'tabs', readProp(props, 'items', []))
  const selected = readProp<string | undefined>(
    props,
    'activeKey',
    readProp<string | undefined>(props, 'value', undefined)
  ) ?? internal.value ?? tabs.find(tab => tab.disabled !== true)?.id

  return createFragment((parent, anchor) => {
    for (const tab of tabs) {
      insertBefore(parent, createTab(tab, props, selected, internal), anchor)
    }
  })
}

function createTab(
  tab: KitTabItem,
  props: KitTabsProps,
  selected: string | undefined,
  internal: { value: string | undefined }
): VobsNode {
  const active = tab.id === selected
  const element = createElement(tab.href === undefined ? 'button' : 'a')
  setAttribute(element, 'class', `vobs-kit-tabs__tab${active ? ' is-active' : ''}`)
  setAttribute(element, 'role', 'tab')
  setAttribute(element, 'aria-selected', active ? 'true' : 'false')
  setOptionalAttribute(element, 'data-tab-id', tab.id)
  if (tab.href === undefined) setAttribute(element, 'type', 'button')
  else setAttribute(element, 'href', tab.href)
  if (tab.disabled === true) {
    setAttribute(element, 'aria-disabled', 'true')
    setProperty(element, 'tabIndex', -1)
    if (tab.href === undefined) setProperty(element, 'disabled', true)
  }

  if (tab.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vobs-kit-tabs__icon')
    mountSlot(icon, tab, 'icon')
    insertBefore(element, icon, null)
  }

  const label = createElement('span')
  setAttribute(label, 'class', 'vobs-kit-tabs__label')
  insertBefore(label, createText(tab.label), null)
  insertBefore(element, label, null)

  const closable = readProp(props, 'closable', false) || tab.closable === true
  if (closable) {
    const close = createElement('button')
    setAttribute(close, 'class', 'vobs-kit-tabs__close')
    setAttribute(close, 'type', 'button')
    setAttribute(close, 'aria-label', `Close ${tab.label}`)
    insertBefore(close, createText('x'), null)
    addEventListener(close, 'click', event => {
      event.stopPropagation?.()
      const handler = readProp<unknown>(props, 'onClose', undefined)
      if (typeof handler === 'function') (handler as KitTabsProps['onClose'])!(tab)
    })
    insertBefore(element, close, null)
  }

  addEventListener(element, 'click', event => {
    if (tab.disabled === true) {
      event.preventDefault?.()
      return
    }
    if (!isControlled(props)) internal.value = tab.id
    const onSelect = readProp<unknown>(props, 'onSelect', undefined)
    if (typeof onSelect === 'function') (onSelect as KitTabsProps['onSelect'])!(tab)
    const onChange = readProp<unknown>(props, 'onChange', undefined)
    if (typeof onChange === 'function') (onChange as KitTabsProps['onChange'])!(tab.id, tab)
  })
  return element
}

function isControlled(props: KitTabsProps): boolean {
  return readProp<string | undefined>(props, 'activeKey', undefined) !== undefined
    || readProp<string | undefined>(props, 'value', undefined) !== undefined
}
