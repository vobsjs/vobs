import { state } from '@vobs/reactivity'
import {
  addEventListener,
  createElement,
  createFragment,
  createText,
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
  readProp,
  resolveSlot,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface EditorTabItem {
  readonly id: string
  readonly label: string
  readonly icon?: VuiChildren
  readonly closeIcon?: VuiChildren
  readonly closeable?: boolean
  readonly disabled?: boolean
}

export interface EditorTabsProps extends VuiCommonProps {
  readonly tabs?: readonly EditorTabItem[]
  readonly value?: string
  readonly defaultValue?: string
  readonly closeIcon?: VuiChildren
  readonly actions?: VuiChildren
  readonly onChange?: (id: string, event: MouseEvent | KeyboardEvent) => void
  readonly onClose?: (id: string, event: MouseEvent) => void
}

export function EditorTabs(props: EditorTabsProps = {}): VobsNode {
  const root = createElement('div')
  const internalValue = state<string | undefined>(undefined)
  bindClassList(root, props, () => ['vui-editortabs'])
  bindCommonAttributes(root, props, [
    'tabs',
    'value',
    'defaultValue',
    'closeIcon',
    'actions',
    'onChange',
    'onClose'
  ])
  bindUserStyle(root, props)
  // 行的容器此前没有任何角色 —— 行上有 role="tab"，屏幕阅读器却找不到它们所属的 tablist。
  setAttribute(root, 'role', 'tablist')
  insertDynamic(root, null, () => createEditorTabs(props, internalValue))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createEditorTabs(
  props: EditorTabsProps,
  internalValue: { value: string | undefined }
): VobsNode {
  const tabs = readProp<readonly EditorTabItem[]>(props, 'tabs', [])
  const selected = activeId(props, tabs, internalValue)
  return createFragment((parent, anchor) => {
    for (const tab of tabs) {
      insertBefore(parent, createEditorTab(tab, tabs, selected, props, internalValue), anchor)
    }

    const spacer = createElement('span')
    setAttribute(spacer, 'class', 'vui-editortabs__spacer')
    insertBefore(parent, spacer, anchor)

    if (hasProp(props, 'actions')) {
      const actions = createElement('span')
      setAttribute(actions, 'class', 'vui-editortabs__actions')
      mountSlot(actions, props, 'actions')
      insertBefore(parent, actions, anchor)
    }
  })
}

function createEditorTab(
  tab: EditorTabItem,
  tabs: readonly EditorTabItem[],
  selected: string | undefined,
  props: EditorTabsProps,
  internalValue: { value: string | undefined }
): VobsNode {
  const active = tab.id === selected
  const root = createElement('span')
  setAttribute(root, 'class', `vui-editortab${active ? ' is-active' : ''}`)
  setAttribute(root, 'role', 'tab')
  // 供方向键切换后定位新行（见 focusEditorTab）
  setAttribute(root, 'data-editor-tab-id', tab.id)
  setAttribute(root, 'aria-selected', active ? 'true' : 'false')
  setAttribute(root, 'tabindex', active ? '0' : '-1')
  setOptionalAttribute(root, 'data-editor-tab-id', tab.id)
  if (tab.disabled === true) setAttribute(root, 'aria-disabled', 'true')

  if (tab.icon !== undefined) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'ic')
    mountSlot(icon, tab, 'icon')
    insertBefore(root, icon, null)
  }
  const label = createElement('span')
  setAttribute(label, 'class', 'vui-editortab__label')
  insertBefore(label, createText(tab.label), null)
  insertBefore(root, label, null)

  if (tab.closeable === true) {
    const close = createElement('button')
    setAttribute(close, 'class', 'close')
    setAttribute(close, 'type', 'button')
    setAttribute(close, 'aria-label', `Close ${tab.label}`)
    const closeIcon = tab.closeIcon ?? readProp<VuiChildren | undefined>(props, 'closeIcon', undefined)
    const icon = closeIcon === undefined ? createText('x') : resolveSlot(closeIcon)
    if (icon) insertBefore(close, icon, null)
    addEventListener(close, 'click', event => {
      event.stopPropagation?.()
      const handler = readProp<unknown>(props, 'onClose', undefined)
      if (typeof handler === 'function') (handler as EditorTabsProps['onClose'])!(tab.id, event as MouseEvent)
    })
    insertBefore(root, close, null)
  }

  addEventListener(root, 'click', event => {
    if (tab.disabled === true) return
    selectTab(tab.id, props, internalValue, event as MouseEvent)
  })
  addEventListener(root, 'keydown', event => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault?.()
      if (tab.disabled !== true) selectTab(tab.id, props, internalValue, keyboardEvent)
      return
    }
    if (keyboardEvent.key !== 'ArrowLeft' && keyboardEvent.key !== 'ArrowRight') return
    keyboardEvent.preventDefault?.()
    const direction = keyboardEvent.key === 'ArrowLeft' ? -1 : 1
    const next = adjacentTab(tabs, tab.id, direction)
    if (next) {
      /*
       * 焦点要跟着走。
       *
       * 原来这里只改选中、不移动焦点 —— 于是焦点停在旧行上，而旧行的 tabindex 因为选中变化
       * 已经变成 -1：DOM 焦点与 aria-selected 分家，键盘用户下一步按方向键仍从旧位置出发。
       *
       * 容器必须在 **selectTab 之前**抓住：选中会触发标签行重建，届时这一行已从 DOM 摘掉，
       * 之后再取 parentElement 得到的是 null（实测踩到：焦点落在游离节点上，等于没动）。
       */
      const container = root.parentElement
      selectTab(next.id, props, internalValue, keyboardEvent)
      if (container) focusEditorTab(container, next.id)
    }
  })
  return root
}

function selectTab(
  id: string,
  props: EditorTabsProps,
  internalValue: { value: string | undefined },
  event: MouseEvent | KeyboardEvent
): void {
  if (readProp<string | undefined>(props, 'value', undefined) === undefined) internalValue.value = id
  const handler = readProp<unknown>(props, 'onChange', undefined)
  if (typeof handler === 'function') (handler as EditorTabsProps['onChange'])!(id, event)
}

/**
 * 把焦点移到目标标签行。
 *
 * 必须在选中触发的重渲染**之后**执行，并重新查一次节点：行的 `tabindex` 是按选中状态在创建时
 * 写死的，所以选中一变整条标签行会重建 —— 对重建前的节点 `focus()` 会被紧接着的刷新丢掉
 * （Tabs 那边实测踩过这个坑，这里同一套做法）。
 *
 * 用属性比较而不是拼选择器：`tab.id` 是使用方给的，含引号时 `querySelector` 会直接抛异常。
 */
function focusEditorTab(container: Element, id: string): void {
  queueMicrotask(() => {
    const target = [...container.querySelectorAll('[data-editor-tab-id]')]
      .find(element => element.getAttribute('data-editor-tab-id') === id)
    if (target instanceof HTMLElement) target.focus()
  })
}
function adjacentTab(
  tabs: readonly EditorTabItem[],
  id: string,
  direction: -1 | 1
): EditorTabItem | undefined {
  const start = tabs.findIndex(tab => tab.id === id)
  if (start < 0) return undefined
  for (let index = start + direction; index >= 0 && index < tabs.length; index += direction) {
    if (tabs[index].disabled !== true) return tabs[index]
  }
  return undefined
}

function activeId(
  props: EditorTabsProps,
  tabs: readonly EditorTabItem[],
  internalValue: { value: string | undefined }
): string | undefined {
  const controlled = readProp<string | undefined>(props, 'value', undefined)
  if (controlled !== undefined) return controlled
  if (internalValue.value !== undefined) return internalValue.value
  const defaultValue = readProp<string | undefined>(props, 'defaultValue', undefined)
  if (defaultValue !== undefined) return defaultValue
  return tabs.find(tab => tab.disabled !== true)?.id
}
