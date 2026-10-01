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
  // 面板此前完全没有 role（只有 tab 有），屏幕阅读器读不出"这是标签页的内容区"。
  setAttribute(panel, 'role', 'tabpanel')

  /*
   * 键盘切换标签（WAI-ARIA tabs 模式）。
   *
   * 原来只有鼠标点击 —— 键盘用户按 Tab 会依次停靠**每一个**标签，方向键毫无反应；
   * 而 `role="tab"` 的存在意味着屏幕阅读器会按"方向键可切换"来播报，两边对不上。
   *
   * 采用 automatic activation（焦点跟着选中走）：标签内容切换很轻，不需要先聚焦再确认。
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
     * 聚焦必须等这一批更新落地、并**重新查一次节点**。
     *
     * 选中会触发标签条重渲染（insertDynamic 重建所有按钮）—— 直接对此刻手里的旧按钮
     * focus() 会被紧接着的刷新丢掉（实测：选中变了、焦点却没跟上，后续方向键全失效）。
     * 更新是按微任务批处理的，所以这里再排一个微任务：它必定排在刷新之后。
     */
    queueMicrotask(() => {
      const target = tablist.querySelector(`[data-tab-id="${next.id}"]`)
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

/** 选中一个标签：受控时不写内部状态，只回调；非受控时先写内部状态再回调。 */
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
       * roving tabindex：只有当前标签是可 Tab 停靠的，其余 -1。
       * 否则键盘用户要按 Tab 穿过每一个标签才能走到面板（WAI-ARIA tabs 的标准做法）。
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
