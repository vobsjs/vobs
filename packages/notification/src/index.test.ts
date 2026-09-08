import { afterEach, describe, expect, it, vi } from 'vitest'
import { createText, createVobs } from '@vobs/vobs'
import {
  NOTIFICATION_KEY,
  NotificationError,
  createNotification,
  notificationPlugin,
  useNotification
} from './index'

describe('@vobs/notification', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('创建响应式通知队列，并提供类型快捷方法与结构化数据', () => {
    const notification = createNotification({ now: () => 1_700_000_000_000 })
    const infoId = notification.info('Background sync started')
    const successId = notification.success('Saved', { title: 'Document', duration: 0, data: { revision: 3 } })

    expect(infoId).toBe('notification-1')
    expect(notification.notifications.value).toEqual([
      expect.objectContaining({ id: infoId, type: 'info', content: 'Background sync started', duration: 4500 }),
      expect.objectContaining({ id: successId, type: 'success', title: 'Document', data: { revision: 3 } })
    ])
    expect(Object.isFrozen(notification.notifications.value)).toBe(true)
    expect(Object.isFrozen(notification.notifications.value[0])).toBe(true)
    notification.dispose()
  })

  it('超时、手动关闭、清空和上限淘汰分别完成生命周期回调', () => {
    vi.useFakeTimers()
    const dismissed: Array<[string, string]> = []
    const notification = createNotification({
      defaultDuration: 50,
      maxNotifications: 2,
      onDismiss: (entry, reason) => dismissed.push([entry.id, reason])
    })
    const timeoutId = notification.info('expires')
    const manualId = notification.info('manual', { duration: 0 })
    notification.dismiss(manualId)
    notification.info('first', { id: 'first', duration: 0 })
    notification.info('second', { id: 'second', duration: 0 })
    vi.advanceTimersByTime(50)
    notification.clear()

    expect(dismissed).toEqual([
      [manualId, 'dismissed'],
      [timeoutId, 'overflow'],
      ['first', 'cleared'],
      ['second', 'cleared']
    ])
    notification.dispose()
  })

  it('同 ID 写入替换旧通知、清理旧 timer，并且关闭不存在通知返回 false', () => {
    vi.useFakeTimers()
    const dismissed = vi.fn()
    const notification = createNotification({ defaultDuration: 20 })
    notification.info('old', { id: 'fixed', onDismiss: dismissed })
    notification.error('new', { id: 'fixed', duration: 0 })
    vi.advanceTimersByTime(20)

    expect(notification.notifications.value).toEqual([expect.objectContaining({ id: 'fixed', content: 'new', type: 'error' })])
    expect(dismissed).toHaveBeenCalledWith(expect.objectContaining({ content: 'old' }), 'replaced')
    expect(notification.dismiss('missing')).toBe(false)
    notification.dispose()
  })

  it('无 DOM 环境不需要浏览器 API，并拒绝无效输入与销毁后使用', () => {
    const notification = createNotification({ defaultDuration: 0 })
    expect(() => notification.notify({ content: '' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_NOTIFICATION' })
    )
    expect(() => createNotification({ defaultDuration: -1 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_DURATION' })
    )
    expect(() => createNotification({ maxNotifications: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_MAX_NOTIFICATIONS' })
    )
    notification.dispose()
    expect(() => notification.info('after destroy')).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_DISPOSED' })
    )
  })

  it('notificationPlugin 注入自有上下文，并随应用销毁清理', () => {
    let injected: ReturnType<typeof createNotification> | undefined
    const app = createVobs({
      render: () => createText('notification'),
      plugins: [
        notificationPlugin({ defaultDuration: 0 }),
        { name: 'consumer', install(context) { injected = context.inject(NOTIFICATION_KEY) } }
      ]
    })
    injected?.success('before destroy')
    expect(injected?.notifications.value).toHaveLength(1)
    app.destroy()
    expect(() => injected?.info('after destroy')).toThrow('已销毁')
  })

  it('未安装插件时 useNotification 给出明确错误', () => {
    const app = createVobs({ render: () => {
      useNotification()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_MISSING' })
    )
    expect(NotificationError).toBeDefined()
  })
})
