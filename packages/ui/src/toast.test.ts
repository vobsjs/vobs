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

  it('同 key 顶替后，已渲染的 toast 行必须跟着更新（标题/正文/类型/role）', () => {
    const notification = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(ToastHost, { notification })
    })
    app.mount(container)
    notification.notify({ id: 'doc', type: 'success', content: 'Saved', title: 'Document' })
    app.update()
    const first = container.querySelector('.vui-toast') as HTMLElement
    expect(first.textContent).toContain('Document')
    expect(first.textContent).toContain('Saved')

    notification.notify({ id: 'doc', type: 'error', content: 'Failed', title: 'Upload' })
    app.update()

    const toast = container.querySelector('.vui-toast') as HTMLElement
    expect(container.querySelectorAll('.vui-toast').length).toBe(1)
    expect(toast).toBe(first)
    expect(toast.textContent).toContain('Upload')
    expect(toast.textContent).toContain('Failed')
    expect(toast.textContent).not.toContain('Document')
    expect(toast.textContent).not.toContain('Saved')
    expect(toast.className).toContain('vui-toast--error')
    expect(toast.getAttribute('role')).toBe('alert')
    app.destroy()
    notification.dispose()
  })

  it('尊重作者传入的 role（不再无条件覆盖成 region）', () => {
    const notification = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(ToastHost, { notification, role: 'log' })
    })
    app.mount(container)
    expect(container.querySelector('.vui-toast-host')?.getAttribute('role')).toBe('log')
    app.destroy()

    const other = document.createElement('main')
    const fallback = createVobs({
      render: () => createComponent(ToastHost, { notification })
    })
    fallback.mount(other)
    expect(other.querySelector('.vui-toast-host')?.getAttribute('role')).toBe('region')
    fallback.destroy()
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
