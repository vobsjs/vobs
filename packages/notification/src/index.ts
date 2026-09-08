import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'
export type NotificationDismissReason = 'dismissed' | 'timeout' | 'replaced' | 'overflow' | 'cleared'

export interface Notification {
  readonly id: string
  readonly type: NotificationType
  readonly title: string | undefined
  readonly content: string
  readonly createdAt: number
  readonly duration: number
  readonly data: unknown
}

export interface NotificationInput {
  readonly id?: string
  readonly type?: NotificationType
  readonly title?: string
  readonly content: string
  readonly duration?: number
  readonly data?: unknown
  readonly onDismiss?: (notification: Notification, reason: NotificationDismissReason) => void
}

export type NotificationOptions = Omit<NotificationInput, 'content' | 'type'>

export interface NotificationContext {
  readonly notifications: Signal<readonly Notification[]>
  notify(input: NotificationInput): string
  info(content: string, options?: NotificationOptions): string
  success(content: string, options?: NotificationOptions): string
  warning(content: string, options?: NotificationOptions): string
  error(content: string, options?: NotificationOptions): string
  dismiss(id: string, reason?: NotificationDismissReason): boolean
  clear(reason?: Exclude<NotificationDismissReason, 'dismissed' | 'timeout' | 'replaced' | 'overflow'>): void
  dispose(): void
}

export interface NotificationOptionsConfig {
  readonly defaultDuration?: number
  readonly maxNotifications?: number
  readonly now?: () => number
  readonly idFactory?: () => string
  readonly onDismiss?: (notification: Notification, reason: NotificationDismissReason) => void
}

export interface NotificationPluginOptions extends NotificationOptionsConfig {
  readonly notification?: NotificationContext
}

export type NotificationErrorCode =
  | 'NOTIFICATION_CONTEXT_MISSING'
  | 'NOTIFICATION_CONTEXT_DISPOSED'
  | 'INVALID_NOTIFICATION'
  | 'INVALID_DURATION'
  | 'INVALID_MAX_NOTIFICATIONS'

export class NotificationError extends Error {
  readonly code: NotificationErrorCode

  constructor(code: NotificationErrorCode, message: string) {
    super(message)
    this.name = 'NotificationError'
    this.code = code
  }
}

export const NOTIFICATION_KEY: InjectionKey<NotificationContext> = createInjectionKey<NotificationContext>('vobs.notification')

export function createNotification(options: NotificationOptionsConfig = {}): NotificationContext {
  const defaultDuration = validateDuration(options.defaultDuration ?? 4500)
  const maxNotifications = validateMaxNotifications(options.maxNotifications ?? 5)
  const notifications = state<readonly Notification[]>([])
  const callbacks = new Map<string, NotificationInput['onDismiss']>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let id = 0
  let disposed = false

  const context: NotificationContext = {
    notifications,

    notify(input): string {
      ensureActive()
      const notification = createEntry(input)
      if (notifications.value.some(current => current.id === notification.id)) {
        context.dismiss(notification.id, 'replaced')
      }

      const next = [...notifications.value, notification]
      const overflow = next.splice(0, Math.max(0, next.length - maxNotifications))
      notifications.value = Object.freeze(next)
      callbacks.set(notification.id, input.onDismiss)
      for (const removed of overflow) finish(removed, 'overflow')
      if (notification.duration > 0) {
        timers.set(notification.id, setTimeout(() => {
          if (!disposed) context.dismiss(notification.id, 'timeout')
        }, notification.duration))
      }
      return notification.id
    },

    info(content, input): string {
      return context.notify({ ...input, content, type: 'info' })
    },

    success(content, input): string {
      return context.notify({ ...input, content, type: 'success' })
    },

    warning(content, input): string {
      return context.notify({ ...input, content, type: 'warning' })
    },

    error(content, input): string {
      return context.notify({ ...input, content, type: 'error' })
    },

    dismiss(id, reason = 'dismissed'): boolean {
      ensureActive()
      const notification = notifications.value.find(current => current.id === id)
      if (!notification) return false
      notifications.value = Object.freeze(notifications.value.filter(current => current.id !== id))
      finish(notification, reason)
      return true
    },

    clear(reason = 'cleared'): void {
      ensureActive()
      const current = notifications.value
      if (current.length === 0) return
      notifications.value = Object.freeze([])
      for (const notification of current) finish(notification, reason)
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      callbacks.clear()
      notifications.value = Object.freeze([])
      notifications.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function createEntry(input: NotificationInput): Notification {
    if (!input || typeof input !== 'object' || typeof input.content !== 'string' || input.content.trim() === '') {
      throw new NotificationError('INVALID_NOTIFICATION', 'Vobs Notification: content 必须是非空字符串')
    }
    if (input.type !== undefined && !isNotificationType(input.type)) {
      throw new NotificationError('INVALID_NOTIFICATION', `Vobs Notification: 不支持通知类型 ${String(input.type)}`)
    }
    if (input.title !== undefined && typeof input.title !== 'string') {
      throw new NotificationError('INVALID_NOTIFICATION', 'Vobs Notification: title 必须是字符串')
    }
    const notificationId = input.id ?? options.idFactory?.() ?? `notification-${++id}`
    if (typeof notificationId !== 'string' || notificationId.trim() === '') {
      throw new NotificationError('INVALID_NOTIFICATION', 'Vobs Notification: id 必须是非空字符串')
    }
    return Object.freeze({
      id: notificationId,
      type: input.type ?? 'info',
      title: input.title,
      content: input.content,
      createdAt: options.now?.() ?? Date.now(),
      duration: input.duration === undefined ? defaultDuration : validateDuration(input.duration),
      data: input.data
    })
  }

  function finish(notification: Notification, reason: NotificationDismissReason): void {
    const timer = timers.get(notification.id)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(notification.id)
    const callback = callbacks.get(notification.id)
    callbacks.delete(notification.id)
    try {
      callback?.(notification, reason)
    } catch {
      // Notification callbacks must not leave timers or queue state inconsistent.
    }
    try {
      options.onDismiss?.(notification, reason)
    } catch {
      // Global observation hooks are isolated from the notification lifecycle.
    }
  }

  function ensureActive(): void {
    if (disposed) {
      throw new NotificationError('NOTIFICATION_CONTEXT_DISPOSED', 'Vobs Notification: 上下文已销毁')
    }
  }
}

export function notificationPlugin(options: NotificationPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/notification',
    version: '0.1.0',
    install(context) {
      const ownedNotification = options.notification ? undefined : createNotification(options)
      context.provide(NOTIFICATION_KEY, options.notification ?? ownedNotification!)
      return () => ownedNotification?.dispose()
    }
  }
}

export function useNotification(): NotificationContext {
  const notification = inject(NOTIFICATION_KEY)
  if (!notification) {
    throw new NotificationError('NOTIFICATION_CONTEXT_MISSING', 'Vobs Notification: 找不到上下文，请安装 notificationPlugin')
  }
  return notification
}

function validateDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new NotificationError('INVALID_DURATION', 'Vobs Notification: duration 必须是大于等于 0 的有限数字')
  }
  return value
}

function validateMaxNotifications(value: number): number {
  if (value !== Infinity && (!Number.isInteger(value) || value <= 0)) {
    throw new NotificationError('INVALID_MAX_NOTIFICATIONS', 'Vobs Notification: maxNotifications 必须是正整数或 Infinity')
  }
  return value
}

function isNotificationType(value: unknown): value is NotificationType {
  return value === 'info' || value === 'success' || value === 'warning' || value === 'error'
}
