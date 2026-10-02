import { MESSAGE_KEY, type MessageData, type Notification, type NotificationContext, type NotificationOptions, type NotificationDismissReason, type NotificationType } from '@vobs/notification'
import {
  addEventListener,
  bindAttribute,
  bindText,
  createElement,
  createText,
  getCurrentOwner,
  inject,
  insertBefore,
  insertDynamic,
  insertList,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { Icon } from './icon'

/*
 * 组件外可用的命令式 message API（外部踩坑文档 P 条）。
 *
 * 原来只有组件形态的 `MessageHost`，而它通过 `inject` 取上下文 ——
 * **只能在组件体内取到**。于是业务方被迫自建 `stores/toast.ts` 全局桥
 * （在 App 挂载时 `bindToast` 一次），这类手搓替代品本身就是后续踩坑温床。
 *
 * 这里把**当前挂载着的**上下文桥到模块级，于是 `message.success('已保存')`
 * 可以在任何地方调用：store、API 层、事件处理器、模块顶层。
 *
 * 为什么用"挂载时绑定、卸载时解绑"而不是让调用方自己传上下文：
 * 上下文有生命周期（`dispose`），绑定-解绑让桥与它同生共死，
 * 不会在上下文销毁后还留着一个指向死对象的引用。
 */
let activeMessageContext: NotificationContext | null = null

function requireMessageContext(): NotificationContext {
  if (activeMessageContext === null) {
    throw new Error(
      'Vobs message: 还没有挂载 MessageHost（或它已卸载）。'
      + '请在应用里渲染一个 <MessageHost /> 并安装 messagePlugin（@vobs/notification）。'
    )
  }
  return activeMessageContext
}

/**
 * 组件外可用的命令式消息 API。
 *
 * 用法（任何位置都可以）：
 * ```ts
 * import { message } from '@vobs/ui'
 * message.success('已保存')
 * const id = message.error('保存失败', { duration: 0 })
 * message.dismiss(id)
 * ```
 *
 * 注意：它依赖界面上**已挂载**一个 `MessageHost`（那才是真正渲染消息的地方）。
 * 没挂载就调用会抛出并说明原因 —— 不静默丢弃，因为"消息没出现"最难查。
 */
export const message = {
  notify(input: Parameters<NotificationContext['notify']>[0]): string {
    return requireMessageContext().notify(input)
  },
  info(content: string, options?: NotificationOptions): string {
    return requireMessageContext().info(content, options)
  },
  success(content: string, options?: NotificationOptions): string {
    return requireMessageContext().success(content, options)
  },
  warning(content: string, options?: NotificationOptions): string {
    return requireMessageContext().warning(content, options)
  },
  error(content: string, options?: NotificationOptions): string {
    return requireMessageContext().error(content, options)
  },
  dismiss(id: string, reason?: NotificationDismissReason): boolean {
    return requireMessageContext().dismiss(id, reason)
  },
  clear(reason?: Parameters<NotificationContext['clear']>[0]): void {
    requireMessageContext().clear(reason)
  },
  /** 当前是否已绑定上下文（测试与条件调用用）。 */
  get bound(): boolean {
    return activeMessageContext !== null
  }
}

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
  /*
   * 把这个上下文桥到模块级，让 `message.success(...)` 在组件外也能用。
   * 卸载时解绑（且只在仍指向自己时解绑 —— 避免后挂载的 Host 被先卸载的覆盖掉）。
   */
  activeMessageContext = message
  getCurrentOwner()?.onDispose(() => {
    if (activeMessageContext === message) activeMessageContext = null
  })
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
