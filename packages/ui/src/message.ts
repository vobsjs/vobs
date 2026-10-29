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
 * Imperative message API usable outside components (item P of the external pitfalls doc).
 *
 * There used to be only the component form `MessageHost`, which obtains the context via
 * `inject` — **only reachable inside a component body**. Consumers were thus forced to build
 * their own global bridge in `stores/toast.ts` (calling `bindToast` once when the App mounts);
 * such hand-rolled substitutes are themselves a breeding ground for future pitfalls.
 *
 * This bridges the **currently mounted** context to module level, so `message.success('Saved')`
 * can be called from anywhere: stores, the API layer, event handlers, module top level.
 *
 * Why "bind on mount, unbind on unmount" instead of letting the caller pass the context:
 * the context has a lifecycle (`dispose`); bind/unbind lets the bridge live and die with it,
 * so no reference to a dead object lingers after the context is destroyed.
 */
let activeMessageContext: NotificationContext | null = null

function requireMessageContext(): NotificationContext {
  if (activeMessageContext === null) {
    throw new Error(
      'Vobs message: no MessageHost is mounted (or it has been unmounted). '
      + 'Render a <MessageHost /> in your app and install messagePlugin (@vobs/notification).'
    )
  }
  return activeMessageContext
}

/**
 * Imperative message API usable outside components.
 *
 * Usage (from anywhere):
 * ```ts
 * import { message } from '@vobs/ui'
 * message.success('Saved')
 * const id = message.error('Save failed', { duration: 0 })
 * message.dismiss(id)
 * ```
 *
 * Note: it requires a `MessageHost` to be **mounted** in the UI (that is what actually renders
 * the messages). Calling without one throws with an explanation — nothing is silently dropped,
 * because "the message didn't show up" is the hardest bug to trace.
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
  /** Whether a context is currently bound (for tests and conditional calls). */
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

/** Default icon name per type (bundled with the built-in @vobs/ui registry, works out of the box; a single message can override with any registered icon name) */
export const MESSAGE_TYPE_ICONS: Record<NotificationType, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-circle'
}

export interface MessageHostProps {
  /** Message context; injected from MESSAGE_KEY when absent (provided by messagePlugin) */
  readonly message?: NotificationContext
  /** Display position (default top center) */
  readonly position?: MessagePosition
  /**
   * Icon, three modes:
   * - false (default): text only
   * - true: show the default icon per message type (info/success/warning/error → MESSAGE_TYPE_ICONS)
   * - string: all messages use this icon name
   * A single message can override via message.open({ icon }) (string to specify / false to force-hide)
   */
  readonly icon?: boolean | string
  /** Readable label of the container (announced by screen readers). Defaults to 'Messages'; pass one when localization is needed. */
  readonly 'aria-label'?: string
  /** Container role. Defaults to 'region'. */
  readonly role?: string
}

export function MessageHost(props: MessageHostProps = {}): VobsNode {
  const message = props.message ?? injectMessage()
  /*
   * Bridge this context to module level so `message.success(...)` also works outside components.
   * Unbind on dispose (and only while it still points at itself — so a later-mounted Host isn't
   * wiped when an earlier one unmounts).
   */
  activeMessageContext = message
  getCurrentOwner()?.onDispose(() => {
    if (activeMessageContext === message) activeMessageContext = null
  })
  const root = createElement('ol')
  const position = readPosition(props)
  setAttribute(root, 'class', `vui-message-host vui-message-host--${position}`)
  // This component does not go through the generic prop channel of ./utils (it reads props
  // directly), so the override path is the explicit props field:
  // these two lines used to be hard-coded, leaving authors no way to pass anything — screen
  // readers would only ever announce the English 'Messages', and role couldn't be changed either.
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
    throw new Error('Vobs MessageHost: no context found; install messagePlugin (@vobs/notification)')
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
   * Rows are reused by key via insertList: a same-key replacement only writes the item signal
   * and does **not rebuild the row** (runtime/src/dynamic.ts:341-351). So we must not "read the
   * entry once and write the DOM" — after a replacement, the content/type/role/icon/click
   * closure would stay stuck on the old values forever.
   * Entry-dependent writes all go into effects (bindText / bindAttribute / insertDynamic),
   * reading the reactive proxy delivered by renderItem. For reference, see
   * table/src/data-table.ts:241-282.
   */
  bindText(text, () => notification.content)
  bindAttribute(item, 'class', () => {
    const data = notification.data as MessageData | undefined
    const clickable = typeof data?.onClick === 'function' ? ' vui-message--clickable' : ''
    return `vui-message vui-message--${notification.type}${clickable}`
  })
  bindAttribute(item, 'data-notification-id', () => notification.id)
  bindAttribute(item, 'role', () => notification.type === 'error' ? 'alert' : 'status')
  // Re-read the current entry inside the event: the copy captured in the closure is stale after a replacement
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

/** Icon resolution precedence: per-item icon (string to specify / false to hide) → host icon (true maps by type / string applies to all) → no icon */
function resolveIcon(notification: Notification, props: MessageHostProps): string | null {
  const data = notification.data as MessageData | undefined
  if (data?.icon === false) return null
  if (typeof data?.icon === 'string' && data.icon !== '') return data.icon
  if (props.icon === true) return MESSAGE_TYPE_ICONS[notification.type] ?? null
  if (typeof props.icon === 'string' && props.icon !== '') return props.icon
  return null
}
