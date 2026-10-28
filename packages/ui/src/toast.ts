import { insertList } from '@vobs/vobs'
import {
  addEventListener,
  bindAttribute,
  bindText,
  createElement,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { type Notification, type NotificationContext, useNotification } from '@vobs/notification'
import { Icon } from './icon'
import { createPortal, type VuiPortalAdapter } from './overlay'
import { bindClassList, bindCommonAttributes, bindUserStyle, readProp } from './utils'
import type { VuiCommonProps } from './types'

export type ToastPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface ToastHostProps extends VuiCommonProps {
  readonly notification?: NotificationContext
  readonly position?: ToastPosition
  readonly closeLabel?: string
  readonly portal?: VuiPortalAdapter<unknown>
  readonly portalTarget?: unknown
}

export function ToastHost(props: ToastHostProps = {}): VobsNode {
  const notification = props.notification ?? useNotification()
  const root = createElement('ol')
  bindClassList(root, props, () => [
    'vui-toast-host',
    `vui-toast-host--${readProp<ToastPosition>(props, 'position', 'top-right')}`
  ])
  bindCommonAttributes(root, props, ['notification', 'position', 'closeLabel', 'portal', 'portalTarget'])
  bindUserStyle(root, props)
  // Don't override when the author passed aria-label/role: these two lines used
  // to hardcode unconditionally, so the author values just written by
  // bindCommonAttributes were instantly swallowed (same shape as the fixed
  // Alert/Switch).
  if (readProp<string | undefined>(props, 'aria-label', undefined) === undefined) {
    setAttribute(root, 'aria-label', 'Notifications')
  }
  if (readProp<string | undefined>(props, 'role', undefined) === undefined) {
    setAttribute(root, 'role', 'region')
  }

  insertList(root, null, () => notification.notifications.value, entry => (
    createToast(entry, notification, readProp(props, 'closeLabel', 'Dismiss notification'))
  ), entry => entry.id)

  const portal = readProp<VuiPortalAdapter<unknown> | undefined>(props, 'portal', undefined)
  return portal
    ? createPortal(root, portal, readProp(props, 'portalTarget', undefined))
    : root
}

function createToast(
  notification: Notification,
  context: NotificationContext,
  closeLabel: string
): VobsNode {
  const item = createElement('li')
  const content = createElement('div')
  const close = createElement('button')
  const message = createElement('div')
  const messageText = createText('')

  /*
   * Rows are reused by key via insertList: a same-key replacement only writes
   * the item signal and **does not rebuild the row**
   * (runtime/src/dynamic.ts:341-351). Entry-dependent writes must go into
   * effects, otherwise type/role/title/body go permanently stale after a
   * replacement (see table/src/data-table.ts:241-282 for the same pattern).
   */
  bindAttribute(item, 'class', () => `vui-toast vui-toast--${notification.type}`)
  bindAttribute(item, 'data-notification-id', () => notification.id)
  bindAttribute(item, 'role', () => notification.type === 'error' ? 'alert' : 'status')
  setAttribute(content, 'class', 'vui-toast__content')
  setAttribute(close, 'class', 'vui-toast__close')
  setAttribute(close, 'type', 'button')
  setAttribute(close, 'aria-label', closeLabel)
  // Read the id at event time: it's the key and normally stable, but reading the current entry is safer anyway
  addEventListener(close, 'click', () => context.dismiss(notification.id))

  setAttribute(message, 'class', 'vui-toast__message')
  insertBefore(message, messageText, null)
  bindText(messageText, () => notification.content)
  insertBefore(content, message, null)
  // The title is a conditional block coming from the entry: go through a dynamic slot so it can be added/changed/removed after a replacement
  insertDynamic(content, message, () => {
    const title = notification.title
    if (!title) return null
    const titleNode = createElement('div')
    setAttribute(titleNode, 'class', 'vui-toast__title')
    insertBefore(titleNode, createText(title), null)
    return titleNode
  })
  insertBefore(close, Icon({ name: 'x', size: 16, decorative: true }), null)
  insertBefore(item, content, null)
  insertBefore(item, close, null)
  return item
}
