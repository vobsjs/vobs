import { MESSAGE_KEY, type MessageData, type Notification, type NotificationContext, type NotificationType } from '@vobs/notification'
import {
  addEventListener,
  bindAttribute,
  bindText,
  createElement,
  createText,
  inject,
  insertBefore,
  insertDynamic,
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
  /** 容器的可读标签（会被读屏播报）。默认 'Messages'，需要本地化时传入。 */
  readonly 'aria-label'?: string
  /** 容器的 role。默认 'region'。 */
  readonly role?: string
}

export function MessageHost(props: MessageHostProps = {}): VobsNode {
  const message = props.message ?? injectMessage()
  const root = createElement('ol')
  const position = readPosition(props)
  setAttribute(root, 'class', `vui-message-host vui-message-host--${position}`)
  // 这个组件不走 ./utils 的通用属性通道（它直接读 props），所以覆盖路径就是显式的 props 字段：
  // 原来这两行写死，作者无路可传 —— 读屏只会念英文 'Messages'，role 也改不了。
  setAttribute(root, 'aria-label', props['aria-label'] ?? 'Messages')
  setAttribute(root, 'role', props.role ?? 'region')

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
  const text = createText('')
  setAttribute(content, 'class', 'vui-message__content')
  insertBefore(content, text, null)

  /*
   * 行会被 insertList 按 key 复用：同 key 顶替只写 item 信号、**不重建行**
   * （runtime/src/dynamic.ts:341-351）。所以这里不能"从条目取一次值就写 DOM" ——
   * 那样顶替后内容/类型/role/图标/点击闭包会永久停留在旧值。
   * 条目相关的写入一律放进 effect（bindText / bindAttribute / insertDynamic），
   * 读 renderItem 拿到的响应式代理。写法对照 table/src/data-table.ts:241-282。
   */
  bindText(text, () => notification.content)
  bindAttribute(item, 'class', () => {
    const data = notification.data as MessageData | undefined
    const clickable = typeof data?.onClick === 'function' ? ' vui-message--clickable' : ''
    return `vui-message vui-message--${notification.type}${clickable}`
  })
  bindAttribute(item, 'data-notification-id', () => notification.id)
  bindAttribute(item, 'role', () => notification.type === 'error' ? 'alert' : 'status')
  // 事件里再取当前条目：闭包里捕获的那一份在被顶替后是旧的
  addEventListener(item, 'click', () => {
    ;(notification.data as MessageData | undefined)?.onClick?.()
  })

  insertBefore(item, content, null)
  insertDynamic(item, content, () => {
    const iconName = resolveIcon(notification, props)
    if (iconName === null) return null
    const iconWrap = createElement('span')
    setAttribute(iconWrap, 'class', `vui-message__icon vui-message__icon--${notification.type}`)
    insertBefore(iconWrap, Icon({ name: iconName, size: 15, decorative: true }), null)
    return iconWrap
  })
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
