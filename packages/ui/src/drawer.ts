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
  setOptionalAttribute,
  setOptionalProperty
} from './utils'
import { createPortal, type VuiPortalAdapter } from './overlay'
import type { VuiCommonProps } from './types'

export type DrawerCloseReason = 'close-button' | 'backdrop' | 'escape'

export interface DrawerProps extends VuiCommonProps {
  readonly open?: boolean
  readonly title?: string
  readonly side?: 'left' | 'right'
  readonly closeOnBackdrop?: boolean
  readonly closeOnEscape?: boolean
  readonly modal?: boolean
  readonly titleId?: string
  readonly descriptionId?: string
  readonly closeLabel?: string
  readonly footer?: VuiCommonProps['children']
  readonly onClose?: (reason: DrawerCloseReason) => void
  readonly portal?: VuiPortalAdapter<unknown>
  readonly portalTarget?: unknown
}

export function Drawer(props: DrawerProps = {}): VobsNode {
  const root = createElement('div')
  const surface = createElement('aside')
  const body = createElement('div')
  bindClassList(root, props, () => ['vui-backdrop'])
  bindUserStyle(root, props)
  bindCommonAttributes(surface, props, [
    'open',
    'title',
    'side',
    'closeOnBackdrop',
    'closeOnEscape',
    'modal',
    'titleId',
    'descriptionId',
    'closeLabel',
    'footer',
    'onClose',
    'portal',
    'portalTarget'
  ])
  setAttribute(root, 'role', 'presentation')
  setAttribute(surface, 'class', 'vui-drawer')
  setAttribute(surface, 'role', 'dialog')
  setAttribute(body, 'class', 'vui-drawer__body')

  effect(() => {
    const open = readProp(props, 'open', false)
    const modal = readProp(props, 'modal', true)
    setOptionalProperty(root, 'hidden', !open)
    setOptionalAttribute(root, 'data-state', open ? 'open' : 'closed')
    setOptionalAttribute(surface, 'aria-modal', modal ? 'true' : 'false')
    setOptionalAttribute(surface, 'aria-labelledby', readProp<string | undefined>(props, 'titleId', undefined))
    setOptionalAttribute(surface, 'aria-describedby', readProp<string | undefined>(props, 'descriptionId', undefined))
    setOptionalAttribute(surface, 'data-side', readProp(props, 'side', 'right'))
  })

  if (hasProp(props, 'title') || hasProp(props, 'onClose')) {
    const head = createElement('header')
    setAttribute(head, 'class', 'vui-drawer__head')
    if (hasProp(props, 'title')) {
      const title = createElement('div')
      const text = createText('')
      setAttribute(title, 'class', 'vui-dialog__title')
      bindTextContent(text, () => readProp(props, 'title', ''))
      insertBefore(title, text, null)
      insertBefore(head, title, null)
    }
    if (hasProp(props, 'onClose')) {
      const close = createElement('button')
      setAttribute(close, 'class', 'vui-dialog__close')
      setAttribute(close, 'type', 'button')
      setAttribute(close, 'aria-label', readProp(props, 'closeLabel', 'Close'))
      insertBefore(close, createText('x'), null)
      addEventListener(close, 'click', () => emitClose(props, 'close-button'))
      insertBefore(head, close, null)
    }
    insertBefore(surface, head, null)
  }

  if (hasProp(props, 'children')) mountSlot(body, props, 'children')
  insertBefore(surface, body, null)
  if (hasProp(props, 'footer')) {
    const footer = createElement('footer')
    setAttribute(footer, 'class', 'vui-dialog__foot')
    mountSlot(footer, props, 'footer')
    insertBefore(surface, footer, null)
  }
  insertBefore(root, surface, null)

  addEventListener(root, 'click', event => {
    if (event.target !== root) return
    if (readProp(props, 'closeOnBackdrop', true)) emitClose(props, 'backdrop')
  })
  addEventListener(root, 'keydown', event => {
    if ((event as KeyboardEvent).key !== 'Escape') return
    if (readProp(props, 'closeOnEscape', true)) emitClose(props, 'escape')
  })

  const portal = readProp<VuiPortalAdapter<unknown> | undefined>(props, 'portal', undefined)
  return portal
    ? createPortal(root, portal, readProp(props, 'portalTarget', undefined))
    : root
}

function emitClose(props: DrawerProps, reason: DrawerCloseReason): void {
  if (!readProp(props, 'open', false)) return
  const handler = readProp<unknown>(props, 'onClose', undefined)
  if (typeof handler === 'function') handler(reason)
}
