// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Dialog, Drawer } from './index'

setRenderer(createDOMRenderer())
const flush = () => { scheduler.flush(); scheduler.flush() }

/*
 * Dialog / Drawer 的焦点管理。
 *
 * 原来两者都声明 `aria-modal="true"` 却**完全没有焦点管理** —— focus trap 就在
 * overlay.ts 里实现好、测过、也导出，只是没有任何组件用它（全仓只有它自己的测试调用）。
 * 后果是实打实的：
 *   - 焦点留在弹窗外的触发按钮上 → Escape 的 keydown 永远到不了组件 root 上的监听
 *     →「按 Esc 关不掉」
 *   - Tab 会跑到弹窗背后的内容里
 *   - 关闭后焦点不回到打开它的元素上
 *
 * 这里锁住四件事：焦点移入、Escape 可用、关闭还原、**非模态不陷阱**。
 */
function mountOverlay(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()

  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  flush()

  const cleanup = (): void => { app.destroy(); host.remove(); trigger.remove() }
  return { host, trigger, cleanup }
}

describe('Dialog/Drawer 焦点管理', () => {
  it('打开时把焦点移入弹窗，并把 Escape 送达（原来焦点在外 → Esc 无效）', () => {
    const open = state(false)
    const closes: string[] = []
    const props = { get open() { return open.value }, onClose: (reason: string) => closes.push(reason) }
    const { host, cleanup } = mountOverlay(Dialog, props)

    open.value = true
    flush()
    expect(host.contains(document.activeElement)).toBe(true)

    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    flush()
    expect(closes).toEqual(['escape'])

    cleanup()
  })

  it('关闭后焦点还原到打开它的元素', () => {
    const open = state(false)
    const { trigger, cleanup } = mountOverlay(Dialog, { get open() { return open.value } })

    open.value = true
    flush()
    open.value = false
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('非模态对话框不抢焦点（与 aria-modal 的判断一致）', () => {
    const open = state(false)
    const { trigger, cleanup } = mountOverlay(Dialog, { get open() { return open.value }, modal: false })

    open.value = true
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('Drawer 同样有焦点管理（不只是 Dialog）', () => {
    const open = state(false)
    const { host, trigger, cleanup } = mountOverlay(Drawer, { get open() { return open.value } })

    open.value = true
    flush()
    expect(host.contains(document.activeElement)).toBe(true)

    open.value = false
    flush()
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })
})
