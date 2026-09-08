import {
  addEventListener,
  createElement,
  createFragment,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type StatusBarDot = 'success' | 'warning' | 'error'

export interface StatusBarItem {
  readonly id?: string
  readonly icon?: VuiChildren
  readonly dot?: StatusBarDot
  readonly label?: VuiChildren
  readonly disabled?: boolean
}

export interface StatusBarProps extends VuiCommonProps {
  readonly left?: readonly StatusBarItem[]
  readonly right?: readonly StatusBarItem[]
  readonly onItemClick?: (id: string, event: MouseEvent) => void
}

export function StatusBar(props: StatusBarProps = {}): VobsNode {
  const root = createElement('footer')
  bindClassList(root, props, () => ['vui-statusbar'])
  bindCommonAttributes(root, props, ['left', 'right', 'onItemClick'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'status')

  if (hasProp(props, 'left')) insertDynamic(root, null, () => createStatusGroup(props, 'left'))
  if (hasProp(props, 'right') || hasProp(props, 'children')) {
    const group = createElement('div')
    setAttribute(group, 'class', 'vui-statusbar__group')
    if (hasProp(props, 'right')) insertDynamic(group, null, () => createStatusItems(props, 'right'))
    if (hasProp(props, 'children')) mountSlot(group, props, 'children')
    insertBefore(root, group, null)
  }
  return root
}

function createStatusGroup(props: StatusBarProps, side: 'left' | 'right'): VobsNode {
  const group = createElement('div')
  setAttribute(group, 'class', 'vui-statusbar__group')
  insertDynamic(group, null, () => createStatusItems(props, side))
  return group
}

function createStatusItems(props: StatusBarProps, side: 'left' | 'right'): VobsNode {
  const items = side === 'left'
    ? readProp<readonly StatusBarItem[]>(props, 'left', [])
    : readProp<readonly StatusBarItem[]>(props, 'right', [])
  return createFragment((parent, anchor) => {
    for (const item of items) insertBefore(parent, createStatusItem(item, props), anchor)
  })
}

function createStatusItem(item: StatusBarItem, props: StatusBarProps): VobsNode {
  const root = createElement('span')
  setAttribute(root, 'class', 'vui-statusbar__item')
  if (item.id !== undefined && readProp<unknown>(props, 'onItemClick', undefined)) {
    setAttribute(root, 'role', 'button')
    setAttribute(root, 'tabindex', item.disabled === true ? '-1' : '0')
  }
  if (item.disabled === true) setAttribute(root, 'aria-disabled', 'true')

  if (item.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-statusbar__icon')
    mountSlot(icon, item, 'icon')
    insertBefore(root, icon, null)
  }
  if (item.dot !== undefined) {
    const dot = createElement('span')
    setAttribute(dot, 'class', `vui-statusbar__dot vui-statusbar__dot--${item.dot}`)
    setAttribute(dot, 'aria-hidden', 'true')
    insertBefore(root, dot, null)
  }
  if (item.label !== undefined) mountSlot(root, item, 'label')

  const activate = (event: Event): void => {
    if (item.disabled === true || item.id === undefined) return
    const handler = readProp<unknown>(props, 'onItemClick', undefined)
    if (typeof handler === 'function') (handler as StatusBarProps['onItemClick'])!(item.id, event as MouseEvent)
  }
  if (item.id !== undefined) {
    addEventListener(root, 'click', activate)
    addEventListener(root, 'keydown', event => {
      const keyboardEvent = event as KeyboardEvent
      if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
      keyboardEvent.preventDefault?.()
      activate(keyboardEvent)
    })
  }
  return root
}
