import { insertList } from '@vobs/vobs'
import {
  addEventListener,
  createElement,
  createText,
  insertBefore,
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
  setAttribute(root, 'aria-label', 'Notifications')
  setAttribute(root, 'role', 'region')

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
  setAttribute(item, 'class', `vui-toast vui-toast--${notification.type}`)
  setAttribute(item, 'data-notification-id', notification.id)
  setAttribute(item, 'role', notification.type === 'error' ? 'alert' : 'status')
  setAttribute(content, 'class', 'vui-toast__content')
  setAttribute(close, 'class', 'vui-toast__close')
  setAttribute(close, 'type', 'button')
  setAttribute(close, 'aria-label', closeLabel)
  addEventListener(close, 'click', () => context.dismiss(notification.id))

  if (notification.title) {
    const title = createElement('div')
    setAttribute(title, 'class', 'vui-toast__title')
    insertBefore(title, createText(notification.title), null)
    insertBefore(content, title, null)
  }
  const message = createElement('div')
  setAttribute(message, 'class', 'vui-toast__message')
  insertBefore(message, createText(notification.content), null)
  insertBefore(content, message, null)
  insertBefore(close, Icon({ name: 'x', size: 16, decorative: true }), null)
  insertBefore(item, content, null)
  insertBefore(item, close, null)
  return item
}
