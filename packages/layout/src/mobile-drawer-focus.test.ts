// @vitest-environment jsdom
/*
 * 移动抽屉关闭后，侧栏里的链接**不得仍可被 Tab 到**。
 *
 * 侧栏在移动端是**屏幕外的 CSS 定位**（靠根节点上的 `vobs-kit-layout--mobile-open`
 * 类滑入滑出）。关掉抽屉时它仍在 DOM、样式上只是被移出视口 ——
 * 而原来 `bindVisibility(sidebar, sidebarVisible)` **完全不看 `mobileOpen`**，
 * 于是键盘用户按 Tab 会跑进看不见的导航（`aria-hidden` 也管不住键盘焦点）。
 *
 * 两条独立的修复，分别锁：
 * 1. `bindVisibility` 补 `inert` —— 隐藏时把子树移出**焦点顺序与无障碍树**
 * 2. 侧栏可见性纳入 `mobileOpen` —— 移动端关抽屉即视为不可见
 *
 * jsdom 的 `window.innerWidth` 默认 1024，所以把 `mobileBreakpoint` 设大于它来进移动模式
 * （既有 `breakpoint.test.ts` 用的就是这个办法）。
 */
import { describe, expect, it } from 'vitest'
import { state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())

function mount(options: { startOpen: boolean }) {
  const open = state(options.startOpen)
  const container = document.createElement('main')
  const link = createElement('a')
  link.setAttribute('href', '#nav')
  const sidebar = createElement('aside')
  sidebar.append(link)
  const app = createVobs({
    render: () => createComponent(KitLayout, {
      // 大于 jsdom 默认 1024 → 进移动模式
      mobileBreakpoint: 1400,
      sidebar,
      get mobileOpen() { return open.value },
      children: 'Content'
    })
  })
  app.mount(container)
  const sidebarEl = (): HTMLElement => container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
  return { app, container, open, sidebarEl, cleanup: () => { app.destroy(); container.remove() } }
}

describe('移动抽屉：关闭时侧栏不得留在 Tab 序列里', () => {
  it('移动端关抽屉 → 侧栏 inert + aria-hidden + hidden', () => {
    const f = mount({ startOpen: false })
    const sidebar = f.sidebarEl()
    expect(sidebar, '找不到侧栏').toBeTruthy()
    expect(sidebar.hasAttribute('inert'), '关闭的侧栏仍可被 Tab 到').toBe(true)
    expect(sidebar.getAttribute('aria-hidden')).toBe('true')
    expect(sidebar.hidden).toBe(true)
    f.cleanup()
  })

  it('移动端开抽屉 → 侧栏可聚焦（没有把功能一起打死）', () => {
    const f = mount({ startOpen: true })
    const sidebar = f.sidebarEl()
    expect(sidebar.hasAttribute('inert')).toBe(false)
    expect(sidebar.getAttribute('aria-hidden')).toBeNull()
    expect(sidebar.hidden).toBe(false)
    f.cleanup()
  })

  it('开 → 关 → 开 之间 inert 正确跟随（不是只在挂载时算一次）', () => {
    const f = mount({ startOpen: true })
    const sidebar = f.sidebarEl()
    expect(sidebar.hasAttribute('inert')).toBe(false)

    f.open.value = false
    f.app.update()
    expect(sidebar.hasAttribute('inert'), '关抽屉后没有加上 inert').toBe(true)

    f.open.value = true
    f.app.update()
    expect(sidebar.hasAttribute('inert'), '重新打开后 inert 没有被移除').toBe(false)
    f.cleanup()
  })

  it('桌面端（非移动断点）不受影响：可见即无 inert', () => {
    const open = state(false)     // 移动抽屉状态为关，但这不是移动端
    const container = document.createElement('main')
    const sidebar = createElement('aside')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        mobileBreakpoint: 100,     // 小于 1024 → 桌面模式
        sidebar,
        get mobileOpen() { return open.value },
        children: 'Content'
      })
    })
    app.mount(container)
    const sidebarEl = container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
    // 桌面端侧栏本来就可见，不该因为 mobileOpen=false 被 inert
    expect(sidebarEl.hasAttribute('inert'), '桌面端被移动状态误伤').toBe(false)
    expect(sidebarEl.hidden).toBe(false)
    app.destroy()
    container.remove()
  })

  it('侧栏插槽为 null → 仍然 hidden + inert（隐藏语义一致）', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        mobileBreakpoint: 1400,
        sidebar: null,
        children: 'Content'
      })
    })
    app.mount(container)
    const sidebarEl = container.querySelector('.vobs-kit-layout__sidebar') as HTMLElement
    expect(sidebarEl.hidden).toBe(true)
    expect(sidebarEl.hasAttribute('inert')).toBe(true)
    app.destroy()
    container.remove()
  })

  it('其它隐藏区域（header/breadcrumb/tabs）同样带上 inert', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        header: null,
        breadcrumb: null,
        tabs: null,
        sidebar: null,
        children: 'Content'
      })
    })
    app.mount(container)
    for (const selector of ['.vobs-kit-layout__header', '.vobs-kit-layout__breadcrumb', '.vobs-kit-layout__tabs']) {
      const el = container.querySelector(selector) as HTMLElement
      if (!el) continue
      expect(el.hidden, `${selector} 未隐藏`).toBe(true)
      expect(el.hasAttribute('inert'), `${selector} 隐藏但没有 inert`).toBe(true)
    }
    app.destroy()
    container.remove()
  })
})
