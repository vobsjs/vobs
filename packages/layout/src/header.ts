import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createElement,
  createText,
  insertBefore,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  setOptionalAttribute
} from './utils'
import type { KitHeaderProps } from './types'

export function KitHeader(props: KitHeaderProps = {}): VobsNode {
  const root = createElement('header')
  const toggleRegion = createElement('div')
  const brand = createElement('div')
  const actions = createElement('div')

  bindClassList(root, props, () => ['vobs-kit-header'])
  bindCommonAttributes(root, props, [
    'logo',
    'title',
    'sidebarToggle',
    'userMenu',
    'headerActions',
    'toggleLabel',
    'onToggleSidebar'
  ])
  bindUserStyle(root, props)
  setAttribute(toggleRegion, 'class', 'vobs-kit-header__toggle')
  if (hasProp(props, 'sidebarToggle')) {
    mountSlot(toggleRegion, props, 'sidebarToggle')
  } else {
    insertBefore(toggleRegion, createDefaultToggle(props), null)
  }

  setAttribute(brand, 'class', 'vobs-kit-header__brand')
  if (readProp(props, 'logo', undefined) !== undefined) {
    const logo = createElement('span')
    setAttribute(logo, 'class', 'vobs-kit-header__logo')
    mountSlot(logo, props, 'logo')
    insertBefore(brand, logo, null)
  }
  if (readProp<string | undefined>(props, 'title', undefined) !== undefined) {
    const title = createElement('h1')
    const text = createText('')
    setAttribute(title, 'class', 'vobs-kit-header__title')
    bindTextContent(text, () => readProp(props, 'title', ''))
    insertBefore(title, text, null)
    insertBefore(brand, title, null)
  }

  setAttribute(actions, 'class', 'vobs-kit-header__actions')
  if (readProp(props, 'headerActions', undefined) !== undefined) mountSlot(actions, props, 'headerActions')
  if (readProp(props, 'userMenu', undefined) !== undefined) mountSlot(actions, props, 'userMenu')

  insertBefore(root, toggleRegion, null)
  insertBefore(root, brand, null)
  insertBefore(root, actions, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createDefaultToggle(props: KitHeaderProps): VobsNode {
  const button = createElement('button')
  const label = createText('')
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', 'vobs-kit-header__toggle-button')
  bindTextContent(label, () => readProp(props, 'toggleLabel', 'Menu'))
  insertBefore(button, label, null)
  addEventListener(button, 'click', () => {
    const handler = readProp<unknown>(props, 'onToggleSidebar', undefined)
    if (typeof handler === 'function') (handler as KitHeaderProps['onToggleSidebar'])!()
  })
  effectToggleLabel(button, props)
  return button
}

function effectToggleLabel(button: Element, props: KitHeaderProps): void {
  effect(() => {
    setOptionalAttribute(button, 'aria-label', readProp(props, 'toggleLabel', 'Menu'))
  })
}
