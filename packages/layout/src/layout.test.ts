import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createElement, createText, createVobs, setRenderer } from '@vobs/vobs'
import { state } from '@vobs/reactivity'
import { KitLayout } from './layout'
import { useKitLayout } from './context'
import { KitSidebar } from './sidebar'
import { KitBreadcrumb } from './breadcrumb'
import { KitTabs } from './tabs'

describe('@vobs/layout', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
    window.innerWidth = 1200
    window.innerHeight = 800
  })

  it('默认插入 Kit header、menu 和内容插槽', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        title: 'Workspace',
        menu: [{ key: '/home', label: 'Home' }],
        children: 'Content'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-layout')).toBeTruthy()
    expect(container.querySelector('.vobs-kit-header__title')?.textContent).toBe('Workspace')
    expect(container.querySelector('.vobs-kit-menu__label')?.textContent).toBe('Home')
    expect(container.querySelector('.vobs-kit-layout__content')?.textContent).toBe('Content')
    expect(container.querySelector('[class*="vui-"]')).toBeNull()
    expect(container.querySelector('[class*="vobs-admin-"]')).toBeNull()
    app.destroy()
  })

  it('默认侧栏宽度交给 CSS，显式配置才写入内联变量', () => {
    const defaultContainer = document.createElement('main')
    const defaultApp = createVobs({
      render: () => createComponent(KitLayout, { menu: [{ key: '/home', label: 'Home' }] })
    })
    defaultApp.mount(defaultContainer)

    const defaultRoot = defaultContainer.querySelector('.vobs-kit-layout') as HTMLElement
    expect(defaultRoot.hasAttribute('style')).toBe(false)
    defaultApp.destroy()

    const configuredContainer = document.createElement('main')
    const configuredApp = createVobs({
      render: () => createComponent(KitLayout, {
        sidebarWidth: 240,
        style: '--vobs-kit-sidebar-width: 260px',
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    configuredApp.mount(configuredContainer)

    const configuredRoot = configuredContainer.querySelector('.vobs-kit-layout') as HTMLElement
    expect(configuredRoot.style.getPropertyValue('--vobs-kit-sidebar-width')).toBe('260px')
    configuredApp.destroy()
  })

  it('侧栏默认收起，显式设置后才默认展开', () => {
    const defaultContainer = document.createElement('main')
    const defaultApp = createVobs({
      render: () => createComponent(KitLayout, {
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    defaultApp.mount(defaultContainer)

    expect(defaultContainer.querySelector('.vobs-kit-layout')?.classList.contains(
      'vobs-kit-layout--sidebar-collapsed'
    )).toBe(true)
    expect(defaultContainer.querySelector('.vobs-kit-layout')?.hasAttribute('sidebarExpanded')).toBe(false)
    defaultApp.destroy()

    const expandedContainer = document.createElement('main')
    const expandedApp = createVobs({
      render: () => createComponent(KitLayout, {
        sidebarExpanded: true,
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    expandedApp.mount(expandedContainer)

    expect(expandedContainer.querySelector('.vobs-kit-layout')?.classList.contains(
      'vobs-kit-layout--sidebar-collapsed'
    )).toBe(false)
    expandedApp.destroy()
  })

  it('显式 sidebarCollapsed 优先于默认展开配置', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        sidebarExpanded: true,
        sidebarCollapsed: true,
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-layout')?.classList.contains(
      'vobs-kit-layout--sidebar-collapsed'
    )).toBe(true)
    app.destroy()
  })

  it('非受控状态可以通过默认 header 切换侧栏', async () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-layout') as HTMLElement
    const toggle = container.querySelector('.vobs-kit-header__toggle-button') as HTMLButtonElement
    expect(root.classList.contains('vobs-kit-layout--sidebar-collapsed')).toBe(true)
    toggle.click()
    await Promise.resolve()

    expect(root.classList.contains('vobs-kit-layout--sidebar-collapsed')).toBe(false)
    expect(container.querySelector('.vobs-kit-sidebar')?.classList.contains('is-collapsed')).toBe(false)
    app.destroy()
  })

  it('窗口尺寸变化仍驱动移动端布局，但销毁后停止监听', async () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-layout')!
    expect(root.classList.contains('vobs-kit-layout--mobile')).toBe(false)

    window.innerWidth = 600
    window.dispatchEvent(new Event('resize'))
    await Promise.resolve()
    expect(root.classList.contains('vobs-kit-layout--mobile')).toBe(true)

    window.innerWidth = 1000
    window.dispatchEvent(new Event('resize'))
    await Promise.resolve()
    expect(root.classList.contains('vobs-kit-layout--mobile')).toBe(false)

    app.destroy()
    window.innerWidth = 600
    window.dispatchEvent(new Event('resize'))
    await Promise.resolve()
    expect(root.classList.contains('vobs-kit-layout--mobile')).toBe(false)
  })

  it('自定义 header 可以通过 KitLayout 上下文控制布局', async () => {
    function CustomHeader() {
      const layout = useKitLayout()
      const button = createElement('button') as HTMLButtonElement
      button.textContent = 'custom toggle'
      button.addEventListener('click', layout.toggleSidebar)
      return button
    }

    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        header: () => createComponent(CustomHeader, {}),
        menu: [{ key: '/home', label: 'Home' }]
      })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-layout') as HTMLElement
    ;(container.querySelector('button') as HTMLButtonElement).click()
    await Promise.resolve()
    expect(root.classList.contains('vobs-kit-layout--sidebar-collapsed')).toBe(false)
    app.destroy()
  })

  it('受控状态只通过 change 回调请求外部更新', async () => {
    const collapsed = state(false)
    const changes: boolean[] = []
    const props = {
      get sidebarCollapsed() { return collapsed.value },
      onSidebarCollapsedChange(value: boolean) { changes.push(value) },
      menu: [{ key: '/home', label: 'Home' }]
    }
    const container = document.createElement('main')
    const app = createVobs({ render: () => createComponent(KitLayout, props) })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-layout') as HTMLElement
    ;(container.querySelector('.vobs-kit-header__toggle-button') as HTMLButtonElement).click()
    await Promise.resolve()
    expect(changes).toEqual([true])
    expect(root.classList.contains('vobs-kit-layout--sidebar-collapsed')).toBe(false)

    collapsed.value = true
    app.update()
    expect(root.classList.contains('vobs-kit-layout--sidebar-collapsed')).toBe(true)
    app.destroy()
  })

  it('null 插槽可以关闭默认区域，显式 backdrop 支持关闭回调', async () => {
    const mobileOpen = state(true)
    let closed = 0
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitLayout, {
        header: null,
        sidebar: createElement('aside'),
        mobileOpen: mobileOpen.value,
        mobileBackdrop: createElement('div'),
        onMobileOpenChange(value) {
          if (!value) closed++
        },
        onCloseSidebar() { closed++ },
        children: 'Content'
      })
    })
    app.mount(container)

    const header = container.querySelector('.vobs-kit-layout__header') as HTMLElement
    expect(header.hidden).toBe(true)
    const root = container.querySelector('.vobs-kit-layout') as HTMLElement
    expect(root.classList.contains('vobs-kit-layout--mobile-open')).toBe(true)
    app.destroy()
    expect(closed).toBe(0)
    void mobileOpen
  })

  it('独立原语接受第三方节点、嵌套菜单、面包屑和 tabs', () => {
    const container = document.createElement('main')
    const externalIcon = createElement('svg')
    const selected: string[] = []
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        root.append(
          createComponent(KitSidebar, {
            items: [{ key: '/group', label: 'Group', icon: externalIcon, children: [{ key: '/child', label: 'Child' }] }],
            activeKey: '/child',
            onSelect: key => selected.push(key)
          }) as Node,
          createComponent(KitBreadcrumb, {
            items: [{ label: 'Home', href: '/' }, { label: 'Current' }]
          }) as Node,
          createComponent(KitTabs, {
            tabs: [{ id: 'home', label: 'Home' }, { id: 'current', label: 'Current' }],
            activeKey: 'current'
          }) as Node,
          createText('') as Node
        )
        return root
      }
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-menu__children')).toBeTruthy()
    expect(container.querySelector('.vobs-kit-menu__icon svg')).toBe(externalIcon)
    expect(container.querySelector('.vobs-kit-breadcrumb [aria-current="page"]')?.textContent).toBe('Current')
    expect(container.querySelector('.vobs-kit-tabs__tab.is-active')?.textContent).toContain('Current')
    ;(container.querySelector('[data-menu-key="/child"] button, [data-menu-key="/child"] a') as HTMLElement)?.click()
    expect(selected).toEqual(['/child'])
    app.destroy()
  })
})
