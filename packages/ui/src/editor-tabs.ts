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
  /** Readable label for close buttons (the tab title is appended). Defaults to Close <title>; pass one to localize. */
  readonly closeLabel?: (tabLabel: string) => string
  readonly onClose?: (id: string, event: MouseEvent) => void
}

export function EditorTabs(props: EditorTabsProps = {}): VobsNode {
  const root = createElement('div')
  const internalValue = state<string | undefined>(undefined, 'internalValue')
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
  // The row container had no role at all before — rows carried role="tab" while screen readers couldn't find their tablist.
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
  // Lets arrow-key navigation locate the new row (see focusEditorTab)
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
    // The close button label is localizable (default Close <title>; this used to be hardcoded English)
    const closeLabel = readProp<((tabLabel: string) => string) | undefined>(props, 'closeLabel', undefined)
    setAttribute(close, 'aria-label', closeLabel ? closeLabel(tab.label) : `Close ${tab.label}`)
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
       * Focus must follow.
       *
       * This used to only change selection without moving focus — so focus
       * stayed on the old row whose tabindex had already become -1 due to the
       * selection change: DOM focus and aria-selected split apart, and the
       * keyboard user's next arrow key still started from the old position.
       *
       * The container must be captured **before selectTab**: selection triggers
       * a rebuild of the tab row, after which this row has been removed from
       * the DOM and parentElement returns null (hit in practice: focus landed
       * on a detached node, i.e. nothing moved).
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
 * Moves focus to the target tab row.
 *
 * Must run **after** the selection-triggered rerender, and re-query the node:
 * a row's `tabindex` is written at creation time based on the selected state,
 * so a selection change rebuilds the whole tab row — calling focus() on the
 * pre-rebuild node gets thrown away by the immediately following refresh
 * (Tabs hit this pit in practice; the same approach is used here).
 *
 * Compares attributes instead of building a selector: `tab.id` comes from the
 * consumer, and `querySelector` throws outright when it contains quotes.
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
