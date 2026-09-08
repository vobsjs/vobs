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
import type { KitBreadcrumbItem, KitBreadcrumbProps } from './types'

export function KitBreadcrumb(props: KitBreadcrumbProps): VobsNode {
  const root = createElement('nav')
  bindClassList(root, props, () => ['vobs-kit-breadcrumb'])
  bindCommonAttributes(root, props, ['items', 'separator', 'onNavigate'])
  if (!hasProp(props, 'aria-label')) setAttribute(root, 'aria-label', 'Breadcrumb')

  const list = createElement('ol')
  setAttribute(list, 'class', 'vobs-kit-breadcrumb__list')
  insertDynamic(list, null, () => createBreadcrumbItems(props))
  insertBefore(root, list, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createBreadcrumbItems(props: KitBreadcrumbProps): VobsNode {
  const items = readProp<readonly KitBreadcrumbItem[]>(props, 'items', [])
  return createFragment((parent, anchor) => {
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      const entry = createElement('li')
      const isLast = index === items.length - 1
      setAttribute(entry, 'class', `vobs-kit-breadcrumb__item${isLast ? ' is-current' : ''}`)
      if (item.key !== undefined) setOptionalAttribute(entry, 'data-breadcrumb-key', item.key)

      if (index > 0) {
        const separator = createElement('span')
        setAttribute(separator, 'class', 'vobs-kit-breadcrumb__separator')
        setAttribute(separator, 'aria-hidden', 'true')
        if (hasProp(props, 'separator')) mountSlot(separator, props, 'separator')
        else insertBefore(separator, createText('/'), null)
        insertBefore(entry, separator, null)
      }

      const content = createBreadcrumbContent(item, props, index, isLast)
      insertBefore(entry, content, null)
      insertBefore(parent, entry, anchor)
    }
  })
}

function createBreadcrumbContent(
  item: KitBreadcrumbItem,
  props: KitBreadcrumbProps,
  index: number,
  isLast: boolean
): VobsNode {
  const isLink = item.href !== undefined && !isLast
  const element = isLink ? createElement('a') : createElement('span')
  setAttribute(element, 'class', 'vobs-kit-breadcrumb__label')
  insertBefore(element, createText(item.label), null)

  if (isLink) {
    setAttribute(element, 'href', item.href!)
    addEventListener(element, 'click', event => {
      if (item.disabled === true) {
        event.preventDefault?.()
        return
      }
      const handler = readProp<unknown>(props, 'onNavigate', undefined)
      if (typeof handler === 'function') {
        (handler as KitBreadcrumbProps['onNavigate'])!(item, index)
      }
    })
  }
  if (item.disabled === true) {
    setAttribute(element, 'aria-disabled', 'true')
    setProperty(element, 'tabIndex', -1)
  }
  if (isLast) setAttribute(element, 'aria-current', 'page')
  return element
}
