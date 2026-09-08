import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createNotification, notificationPlugin } from '@vobs/notification'
import { createDOMPortalAdapter } from './overlay'
import { ToastHost } from './toast'

describe('@vobs/ui ToastHost', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('消费 NotificationContext，按类型呈现可访问 toast 并允许手动关闭', () => {
    const notification = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(ToastHost, { notification, position: 'bottom-left' })
    })
    app.mount(container)
    notification.success('Saved', { title: 'Document' })
    app.update()

    const toast = container.querySelector('[data-notification-id="notification-1"]') as HTMLElement
    expect(toast.className).toContain('vui-toast--success')
    expect(toast.getAttribute('role')).toBe('status')
    expect(toast.textContent).toContain('Document')
    expect(container.querySelector('.vui-toast-host')?.className).toContain('bottom-left')
    ;(toast.querySelector('button') as HTMLButtonElement).click()
    app.update()
    expect(container.querySelector('.vui-toast')).toBeNull()
    app.destroy()
    notification.dispose()
  })

  it('可通过 notificationPlugin 读取上下文，并支持 portal 与 error alert', () => {
    const notification = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const target = document.createElement('aside')
    const app = createVobs({
      render: () => createComponent(ToastHost, {
        portal: createDOMPortalAdapter(),
        portalTarget: target
      }),
      plugins: [notificationPlugin({ notification })]
    })
    app.mount(container)
    notification.error('Cannot save')
    app.update()

    expect(container.querySelector('.vui-toast-host')).toBeNull()
    expect(target.querySelector('.vui-toast')?.getAttribute('role')).toBe('alert')
    app.destroy()
    expect(target.querySelector('.vui-toast-host')).toBeNull()
    notification.dispose()
  })
})
