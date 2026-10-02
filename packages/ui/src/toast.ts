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
  // 作者传了 aria-label/role 就不覆盖：这两行原来无条件硬编码，
  // 于是 bindCommonAttributes 刚写进去的作者值立刻被吞掉（与已修的 Alert/Switch 同型）。
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
   * 行会被 insertList 按 key 复用：同 key 顶替只写 item 信号、**不重建行**
   * （runtime/src/dynamic.ts:341-351）。条目相关的写入必须放进 effect，
   * 否则顶替后类型/role/标题/正文永久陈旧（对照 table/src/data-table.ts:241-282）。
   */
  bindAttribute(item, 'class', () => `vui-toast vui-toast--${notification.type}`)
  bindAttribute(item, 'data-notification-id', () => notification.id)
  bindAttribute(item, 'role', () => notification.type === 'error' ? 'alert' : 'status')
  setAttribute(content, 'class', 'vui-toast__content')
  setAttribute(close, 'class', 'vui-toast__close')
  setAttribute(close, 'type', 'button')
  setAttribute(close, 'aria-label', closeLabel)
  // 事件里再取 id：id 是 key，正常不变，但读当前条目同样更安全
  addEventListener(close, 'click', () => context.dismiss(notification.id))

  setAttribute(message, 'class', 'vui-toast__message')
  insertBefore(message, messageText, null)
  bindText(messageText, () => notification.content)
  insertBefore(content, message, null)
  // 标题是条件块且来自条目：走动态槽位，顶替后能加/改/去掉
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
