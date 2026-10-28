// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, useDismiss } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { state } from '@vobs/reactivity'

const down = (target: Element): void => {
  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
}

/*
 * useDismiss（浮层点外关闭标准原语，死穴 §8 根治）。
 *
 * 调用形态 = **组件体内**（Owner 自动挂组件树：组件卸载级联清理 document 监听）。
 * 测试统一走 createComponent 挂载，与真实用法同构。
 */
function mountPopup(options: Record<string, unknown> = {}): {
  host: HTMLElement
  popup: HTMLElement
  open: ReturnType<typeof state<boolean>>
  unmount: () => void
} {
  const host = document.createElement('div')
  document.body.append(host)
  const open = state(true)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(() => {
      if (!open.value) return null
      const popup = document.createElement('div')
      popup.className = 'popup'
      const item = document.createElement('button')
      popup.append(item)
      useDismiss(popup, () => { open.value = false }, options)
      return popup
    }, {})
  })
  app.mount(host)
  const popup = host.querySelector('.popup') as HTMLElement
  return { host, popup, open, unmount: () => app.destroy() }
}

describe('useDismiss（浮层点外关闭标准原语，死穴 §8 根治）', () => {
  it('外点关闭、浮层内点击不关闭（菜单项 click 不落死节点）', () => {
    const { host, popup, open, unmount } = mountPopup()
    const item = popup.querySelector('button') as HTMLElement

    // 浮层内点击（含 mousedown）——不关闭；click 由菜单项自身 handler 处理
    down(popup)
    down(item)
    expect(open.value).toBe(true)
    expect(host.contains(popup)).toBe(true)

    // 外点——关闭
    down(document.body)
    expect(open.value).toBe(false)
    unmount()
  })

  it('also 节点（触发按钮）视为内部——打开点击不会立即自关', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const trigger = document.createElement('button')
    host.append(trigger)
    const popup = document.createElement('div')
    host.append(popup)

    let closeCount = 0
    const owner = createVobs({
      renderer: createDOMRenderer(),
      render: () => createComponent(() => {
        useDismiss(popup, () => { closeCount++ }, { also: [trigger] })
        return popup
      }, {})
    })
    owner.mount(host)

    down(trigger)
    expect(closeCount).toBe(0)
    down(popup)
    expect(closeCount).toBe(0)
    down(document.body)
    expect(closeCount).toBe(1)
    owner.destroy()
    host.remove()
  })

  it('Escape 关闭（可关）', () => {
    const { open, unmount } = mountPopup()
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(open.value).toBe(false)
    unmount()

    // escape: false 时不响应
    const second = mountPopup({ escape: false })
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(second.open.value).toBe(true)
    second.unmount()
  })

  it('keepFocusInside：浮层内 mousedown preventDefault（保输入框选区），外点不拦', () => {
    const host = document.createElement('div')
    document.body.append(host)
    let prevented = 0
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => createComponent(() => {
        const popup = document.createElement('div')
        const input = document.createElement('input')
        popup.append(input)
        popup.addEventListener('mousedown', e => {
          if (e.defaultPrevented) prevented++
        })
        useDismiss(popup, () => {}, { keepFocusInside: true })
        return popup
      }, {})
    })
    app.mount(host)
    const input = host.querySelector('input') as HTMLElement

    down(input)
    expect(prevented).toBe(1)

    const outside = document.createElement('div')
    document.body.append(outside)
    down(outside)
    expect(prevented).toBe(1)
    app.destroy()
    outside.remove()
  })

  it('组件卸载级联清理 document 监听（外点不再触发 close）', () => {
    const { open, unmount } = mountPopup()
    expect(open.value).toBe(true)
    unmount()
    down(document.body)
    // Owner 已随组件卸载级联销毁：监听已移除，close 不再被触发（open 保持初始值）
    expect(open.value).toBe(true)
  })
})
