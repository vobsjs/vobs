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
  resolveSlot,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface PaginationProps extends VuiCommonProps {
  readonly page?: number
  readonly pageCount?: number
  readonly siblingCount?: number
  readonly disabled?: boolean
  readonly previousLabel?: string
  readonly nextLabel?: string
  readonly previousIcon?: VuiChildren
  readonly nextIcon?: VuiChildren
  readonly onChange?: (page: number) => void
}

type PaginationItem = number | 'ellipsis-left' | 'ellipsis-right'

export function Pagination(props: PaginationProps = {}): VobsNode {
  const root = createElement('nav')
  bindClassList(root, props, () => ['vui-pagination'])
  bindCommonAttributes(root, props, [
    'page',
    'pageCount',
    'siblingCount',
    'disabled',
    'previousLabel',
    'nextLabel',
    'previousIcon',
    'nextIcon',
    'onChange'
  ])
  if (!hasProp(props, 'aria-label')) setAttribute(root, 'aria-label', 'Pagination')
  insertDynamic(root, null, () => createPaginationItems(props))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createPaginationItems(props: PaginationProps): VobsNode {
  const pageCount = Math.max(0, Math.floor(readProp(props, 'pageCount', 0)))
  const page = clampPage(readProp(props, 'page', 1), pageCount)
  const siblingCount = Math.max(0, Math.floor(readProp(props, 'siblingCount', 1)))
  const disabled = readProp(props, 'disabled', false)
  const items = pageCount === 0 ? [] : buildPaginationItems(page, pageCount, siblingCount)

  return createFragment((parent, anchor) => {
    insertBefore(parent, createPaginationControl(props, 'previous', page <= 1 || disabled), anchor)
    for (const item of items) {
      if (typeof item === 'number') {
        insertBefore(parent, createPageButton(item, item === page, disabled, props), anchor)
      } else {
        insertBefore(parent, createEllipsis(item), anchor)
      }
    }
    insertBefore(parent, createPaginationControl(props, 'next', page >= pageCount || pageCount === 0 || disabled), anchor)
  })
}

function createPaginationControl(
  props: PaginationProps,
  direction: 'previous' | 'next',
  disabled: boolean
): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', 'vui-pagination__item')
  setAttribute(button, 'type', 'button')
  setProperty(button, 'disabled', disabled)
  setOptionalAttribute(button, 'aria-label', direction === 'previous'
    ? readProp(props, 'previousLabel', 'Previous')
    : readProp(props, 'nextLabel', 'Next'))
  if (disabled) setAttribute(button, 'aria-disabled', 'true')

  const icon = direction === 'previous'
    ? readProp<VuiChildren | undefined>(props, 'previousIcon', undefined)
    : readProp<VuiChildren | undefined>(props, 'nextIcon', undefined)
  const fallback = direction === 'previous' ? '<' : '>'
  const node = icon === undefined ? createText(fallback) : resolveSlot(icon)
  if (node) insertBefore(button, node, null)

  addEventListener(button, 'click', () => {
    if (disabled) return
    const current = readProp(props, 'page', 1)
    const nextPage = direction === 'previous' ? current - 1 : current + 1
    emitPageChange(props, clampPage(nextPage, readProp(props, 'pageCount', 0)))
  })
  return button
}

function createPageButton(
  page: number,
  active: boolean,
  disabled: boolean,
  props: PaginationProps
): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', `vui-pagination__item${active ? ' is-active' : ''}`)
  setAttribute(button, 'type', 'button')
  setProperty(button, 'disabled', disabled)
  setAttribute(button, 'aria-label', `Page ${page}`)
  if (active) setAttribute(button, 'aria-current', 'page')
  if (disabled) setAttribute(button, 'aria-disabled', 'true')
  insertBefore(button, createText(String(page)), null)
  addEventListener(button, 'click', () => {
    if (!disabled) emitPageChange(props, page)
  })
  return button
}

function createEllipsis(item: 'ellipsis-left' | 'ellipsis-right'): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', 'vui-pagination__item')
  setAttribute(button, 'type', 'button')
  setProperty(button, 'disabled', true)
  setAttribute(button, 'aria-label', item === 'ellipsis-left' ? 'Previous pages' : 'Next pages')
  setAttribute(button, 'aria-hidden', 'true')
  insertBefore(button, createText('...'), null)
  return button
}

function emitPageChange(props: PaginationProps, page: number): void {
  const handler = readProp<unknown>(props, 'onChange', undefined)
  if (typeof handler === 'function') (handler as PaginationProps['onChange'])!(page)
}

function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1
  return Math.min(pageCount, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)))
}

function buildPaginationItems(page: number, pageCount: number, siblingCount: number): PaginationItem[] {
  const totalVisible = siblingCount * 2 + 5
  if (pageCount <= totalVisible) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  const left = Math.max(page - siblingCount, 2)
  const right = Math.min(page + siblingCount, pageCount - 1)
  const items: PaginationItem[] = [1]

  if (left > 2) items.push('ellipsis-left')
  for (let value = left; value <= right; value++) items.push(value)
  if (right < pageCount - 1) items.push('ellipsis-right')
  items.push(pageCount)
  return items
}
