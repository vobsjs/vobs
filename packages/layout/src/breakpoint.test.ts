// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createComponent } from '@vobs/runtime'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * `mobileBreakpoint` 必须是响应式的。
 *
 * 原来 KitLayout 在组件体里 `normalizeBreakpoint(readProp(props, 'mobileBreakpoint', …))` 算一次，
 * 把**数字**交给 createKitViewport —— 而组件体只执行一次，于是事后改断点毫无作用：
 * 实测把断点从 768 改成 600，`vobs-kit-layout--mobile` 类不消失。
 *
 * 现在断点是 memo、传给 viewport 的是 getter，viewport 在 `isMobile` 的 memo 里读它
 * —— 断点变了 isMobile 就跟着变。这里两个方向都断言。
 *
 * jsdom 的 window.innerWidth 默认 1024。
 */
const INNER_WIDTH = 1024

function mount(initialBreakpoint: number) {
  const breakpoint = state(initialBreakpoint)
  const props: Parameters<typeof KitLayout>[0] = { get mobileBreakpoint() { return breakpoint.value } }
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(KitLayout, props) })
  app.mount(host)
  const root = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-kit-layout')
  const isMobile = (): boolean => root()?.classList.contains('vobs-kit-layout--mobile') ?? false
  return { breakpoint, root, isMobile, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitLayout mobileBreakpoint 响应性', () => {
  it('断点调高到超过窗口宽度时进入移动布局，调回来后退出', async () => {
    const { breakpoint, isMobile, cleanup } = mount(600)
    await settle()
    expect(INNER_WIDTH).toBeGreaterThan(600)
    expect(isMobile()).toBe(false)

    breakpoint.value = 2000                      // 1024 < 2000 → 移动布局
    await settle()
    expect(isMobile()).toBe(true)

    breakpoint.value = 600                       // 再调回来 → 应当退出（原来这里仍然是 true）
    await settle()
    expect(isMobile()).toBe(false)

    cleanup()
  })
})
