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
  const internalValue = state<string | undefined>(undefined, 'internalValue')

  bindClassList(root, props, () => ['vui-tabs-root'])
  bindCommonAttributes(root, props, ['items', 'value', 'variant', 'onChange'])
  setAttribute(tablist, 'role', 'tablist')
  effect(() => {
    const variant = readProp<'default' | 'filled'>(props, 'variant', 'default')
    setAttribute(tablist, 'class', `vui-tabs${variant === 'filled' ? ' vui-tabs--filled' : ''}`)
  })
  setAttribute(panel, 'class', 'vui-tabs__panel')
  // The panel had no role at all before (only the tab did), so screen readers couldn't announce "this is the tab panel's content area".
  setAttribute(panel, 'role', 'tabpanel')

  /*
   * Keyboard tab switching (WAI-ARIA tabs pattern).
   *
   * Only mouse clicks existed before — keyboard users had to Tab through
   * **every** tab and the arrow keys did nothing; yet `role="tab"` means
   * screen readers announce "arrow keys switch tabs", so the two disagreed.
   *
   * Uses automatic activation (focus follows selection): switching tab content
   * is cheap, so no focus-then-confirm step is needed.
   */
  addEventListener(tablist, 'keydown', event => {
    const key = (event as KeyboardEvent).key
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
    const enabled = readProp<readonly TabItem[]>(props, 'items', []).filter(item => item.disabled !== true)
    if (enabled.length === 0) return
    event.preventDefault()
    const currentIndex = enabled.findIndex(item => item.id === activeId(props, internalValue))
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? enabled.length - 1
        : currentIndex < 0
          ? 0
          : (currentIndex + (key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
    const next = enabled[nextIndex]
    selectTab(props, internalValue, next)
    /*
     * Focus must wait for this batch of updates to land and **re-query the
     * node**.
     *
     * Selection triggers a rerender of the tab strip (insertDynamic rebuilds
     * all buttons) — calling focus() on the stale button in hand gets thrown
     * away by the immediately following refresh (verified: selection changed
     * but focus didn't follow, and subsequent arrow keys all stopped working).
     * Updates are batched on microtasks, so queue another microtask here: it
     * is guaranteed to run after the refresh.
     */
    queueMicrotask(() => {
      // Compare attributes instead of building a selector: querySelector throws when an author id contains quotes.
      const target = [...tablist.querySelectorAll('[data-tab-id]')]
        .find(element => element.getAttribute('data-tab-id') === next.id)
      if (target instanceof HTMLElement) target.focus()
    })
  })

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

/** Select a tab: controlled mode only invokes the callback without writing internal state; uncontrolled writes internal state first, then the callback. */
function selectTab(
  props: TabsProps,
  internalValue: { value: string | undefined },
  item: TabItem
): void {
  if (item.disabled === true) return
  if (readProp<string | undefined>(props, 'value', undefined) === undefined) internalValue.value = item.id
  const onChange = readProp<unknown>(props, 'onChange', undefined)
  if (typeof onChange === 'function') onChange(item.id)
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
      /*
       * Roving tabindex: only the current tab is a Tab stop, the rest get -1.
       * Otherwise keyboard users must Tab through every tab to reach the panel
       * (the standard WAI-ARIA tabs practice).
       */
      setAttribute(button, 'tabindex', isActive ? '0' : '-1')
      if (item.disabled === true) {
        setAttribute(button, 'aria-disabled', 'true')
        setProperty(button, 'disabled', true)
      }
      insertBefore(button, createText(item.label), null)
      addEventListener(button, 'click', () => { selectTab(props, internalValue, item) })
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
