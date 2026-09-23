import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, inject, setRenderer } from '@vobs/vobs'
import { createNotification, MESSAGE_KEY, messagePlugin, useMessage, type MessageApi, type NotificationContext } from '@vobs/notification'
import { registerIcon } from './icon'
import { MessageHost } from './message'

describe('@vobs/ui MessageHost', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('默认纯文字，渲染顶部居中胶囊并支持类型样式', () => {
    const message = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(MessageHost, { message })
    })
    app.mount(container)
    message.success('已保存')
    app.update()

    const host = container.querySelector('.vui-message-host') as HTMLElement
    expect(host.className).toContain('top-center')
    const item = container.querySelector('[data-notification-id="notification-1"]') as HTMLElement
    expect(item.className).toContain('vui-message--success')
    expect(item.getAttribute('role')).toBe('status')
    expect(item.textContent).toContain('已保存')
    expect(item.querySelector('.vui-message__icon')).toBeNull()
    app.destroy()
    message.dispose()
  })

  it('宿主开启图标后按类型映射默认图标；error 使用 alert 角色', () => {
    const message = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(MessageHost, { message, icon: true })
    })
    app.mount(container)
    message.error('保存失败')
    app.update()

    const item = container.querySelector('[data-notification-id="notification-1"]') as HTMLElement
    expect(item.getAttribute('role')).toBe('alert')
    expect(item.querySelector('.vui-message__icon--error')).not.toBeNull()
    expect(item.querySelector('svg')).not.toBeNull()
    app.destroy()
    message.dispose()
  })

  it('单条消息可指定图标或强制隐藏；onClick 绑定到整条消息', () => {
    const unregister = registerIcon({ name: 'lucide:loader', path: '<circle cx="12" cy="12" r="9"/>' })
    let api: MessageApi | null = null
    const onClick = vi.fn()
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        api = useMessage()
        return createComponent(MessageHost, { icon: true })
      },
      plugins: [messagePlugin({ defaultDuration: 0 })]
    })
    app.mount(container)
    api!.open({ content: '加载中', icon: 'lucide:loader' })
    api!.open({ content: '无图标', icon: false, type: 'success', onClick })
    app.update()

    const items = container.querySelectorAll('.vui-message')
    expect(items.length).toBe(2)
    expect(items[0]?.querySelector('.vui-message__icon svg')).not.toBeNull()
    expect(items[1]?.querySelector('.vui-message__icon')).toBeNull()
    ;(items[1] as HTMLElement).click()
    expect(onClick).toHaveBeenCalledTimes(1)
    app.destroy()
    unregister()
  })

  it('经 messagePlugin 注入上下文；同 key 顶替旧消息', () => {
    let captured: NotificationContext | null = null
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        captured = inject<NotificationContext | null>(MESSAGE_KEY, null)
        return createComponent(MessageHost, { icon: true })
      },
      plugins: [messagePlugin({ defaultDuration: 0 })]
    })
    app.mount(container)
    const message = captured!
    expect(message).not.toBeNull()
    message.notify({ id: 'save', type: 'success', content: '第一次' })
    message.notify({ id: 'save', type: 'info', content: '第二次' })
    app.update()

    const items = container.querySelectorAll('.vui-message')
    expect(items.length).toBe(1)
    expect(items[0]?.textContent).toContain('第二次')
    expect(items[0]?.className).toContain('vui-message--info')
    app.destroy()
  })
})
