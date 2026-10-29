import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, inject, setRenderer } from '@vobs/vobs'
import { createNotification, MESSAGE_KEY, messagePlugin, useMessage, type MessageApi, type NotificationContext } from '@vobs/notification'
import { registerIcon } from './icon'
import { MessageHost } from './message'

describe('@vobs/ui MessageHost', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('text only by default, renders a top-center pill with type styling', () => {
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

  it('with host icons on, default icons map by type; error uses the alert role', () => {
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

  it('a single message can specify an icon or force-hide it; onClick binds to the whole message', () => {
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

  /*
   * Rows are reused by key via insertList: a same-key replacement only writes the item signal
   * and does **not rebuild the row** (runtime/src/dynamic.ts:341-351). So any row code that
   * "reads the entry once and writes the DOM" stays stuck on the old values forever after a
   * replacement — the case below must bite on that.
   * The case above put the two notifies in the same batch, which happened to build the row only
   * once and masked the problem.
   */
  it('after a same-key replacement, the already-rendered row must follow (content/type/role/icon/click closure)', () => {
    const message = createNotification({ defaultDuration: 0 })
    const container = document.createElement('main')
    const firstClick = vi.fn()
    const secondClick = vi.fn()
    const app = createVobs({
      render: () => createComponent(MessageHost, { message, icon: true })
    })
    app.mount(container)

    message.notify({ id: 'save', type: 'success', content: '第一次', data: { onClick: firstClick } })
    app.update()
    const first = container.querySelector('.vui-message') as HTMLElement
    expect(first.textContent).toContain('第一次')
    expect(first.querySelector('.vui-message__icon--success')).not.toBeNull()

    message.notify({ id: 'save', type: 'error', content: '第二次', data: { onClick: secondClick } })
    app.update()

    const item = container.querySelector('.vui-message') as HTMLElement
    expect(container.querySelectorAll('.vui-message').length).toBe(1)
    expect(item).toBe(first)
    expect(item.textContent).toContain('第二次')
    expect(item.className).toContain('vui-message--error')
    expect(item.getAttribute('role')).toBe('alert')
    expect(item.querySelector('.vui-message__icon--error')).not.toBeNull()
    expect(item.querySelector('.vui-message__icon--success')).toBeNull()

    item.click()
    expect(secondClick).toHaveBeenCalledTimes(1)
    expect(firstClick).not.toHaveBeenCalled()
    app.destroy()
    message.dispose()
  })

  it('context is injected via messagePlugin; a same-key notify replaces the old message', () => {
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
