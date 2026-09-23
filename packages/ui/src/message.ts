import { MESSAGE_KEY, type MessageData, type Notification, type NotificationContext, type NotificationType } from '@vobs/notification'
import {
  addEventListener,
  createElement,
  createText,
  inject,
  insertBefore,
  insertList,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { Icon } from './icon'

export type MessagePosition =
  | 'top-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'

/** 各类型默认图标名（@vobs/ui 内置注册表自带，开箱即用；单条消息可传任意已注册图标名覆盖） */
export const MESSAGE_TYPE_ICONS: Record<NotificationType, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-circle'
}

export interface MessageHostProps {
  /** 消息上下文；缺省注入 MESSAGE_KEY（messagePlugin 提供） */
  readonly message?: NotificationContext
  /** 展示位置（默认顶部居中） */
  readonly position?: MessagePosition
  /**
   * 图标三档：
   * - false（默认）：纯文字
   * - true：按消息类型显示默认图标（info/success/warning/error → MESSAGE_TYPE_ICONS）
   * - 字符串：所有消息统一使用该图标名
   * 单条消息可用 message.open({ icon }) 覆盖（string 指定 / false 强制隐藏）
   */
  readonly icon?: boolean | string
}

export function MessageHost(props: MessageHostProps = {}): VobsNode {
  const message = props.message ?? injectMessage()
  const root = createElement('ol')
  const position = readPosition(props)
  setAttribute(root, 'class', `vui-message-host vui-message-host--${position}`)
  setAttribute(root, 'aria-label', 'Messages')
  setAttribute(root, 'role', 'region')

  insertList(root, null, () => message.notifications.value, entry => (
    createMessageItem(entry, props)
  ), entry => entry.id)
  return root
}

function injectMessage(): NotificationContext {
  const message = inject(MESSAGE_KEY)
  if (!message) {
    throw new Error('Vobs MessageHost: 找不到上下文，请安装 messagePlugin（@vobs/notification）')
  }
  return message
}

function readPosition(props: MessageHostProps): MessagePosition {
  const value = Reflect.get(props, 'position')
  return typeof value === 'string' && value.length > 0 ? value as MessagePosition : 'top-center'
}

function createMessageItem(
  notification: Notification,
  props: MessageHostProps
): VobsNode {
  const item = createElement('li')
  const content = createElement('div')
  setAttribute(item, 'class', `vui-message vui-message--${notification.type}`)
  setAttribute(item, 'data-notification-id', notification.id)
  setAttribute(item, 'role', notification.type === 'error' ? 'alert' : 'status')
  setAttribute(content, 'class', 'vui-message__content')
  insertBefore(content, createText(notification.content), null)

  const iconName = resolveIcon(notification, props)
  if (iconName !== null) {
    const iconWrap = createElement('span')
    setAttribute(iconWrap, 'class', `vui-message__icon vui-message__icon--${notification.type}`)
    insertBefore(iconWrap, Icon({ name: iconName, size: 15, decorative: true }), null)
    insertBefore(item, iconWrap, null)
  }
  insertBefore(item, content, null)

  const data = notification.data as MessageData | undefined
  if (typeof data?.onClick === 'function') {
    setAttribute(item, 'class', `vui-message vui-message--${notification.type} vui-message--clickable`)
    addEventListener(item, 'click', () => data.onClick?.())
  }
  return item
}

/** 图标解析优先级：单条 icon（string 指定 / false 隐藏）→ 宿主 icon（true 按类型映射 / 字符串统一）→ 无图标 */
function resolveIcon(notification: Notification, props: MessageHostProps): string | null {
  const data = notification.data as MessageData | undefined
  if (data?.icon === false) return null
  if (typeof data?.icon === 'string' && data.icon !== '') return data.icon
  if (props.icon === true) return MESSAGE_TYPE_ICONS[notification.type] ?? null
  if (typeof props.icon === 'string' && props.icon !== '') return props.icon
  return null
}
