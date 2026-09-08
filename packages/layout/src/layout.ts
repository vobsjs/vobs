import { effect, memo, state } from '@vobs/reactivity'
import {
  addEventListener,
  createComponent,
  createElement,
  createText,
  insertBefore,
  insertDynamic,
  provide,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import { KIT_LAYOUT_KEY } from './context'
import { KitHeader } from './header'
import { KitSidebar } from './sidebar'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  resolveSlot,
  setOptionalAttribute
} from './utils'
import {
  createKitViewport,
  DEFAULT_MOBILE_BREAKPOINT,
  normalizeBreakpoint
} from './viewport'
import type {
  KitLayoutContext,
  KitLayoutProps,
  KitMenuItem,
  KitSidebarVariant
} from './types'

export function KitLayout(props: KitLayoutProps = {}): VobsNode {
  const root = createElement('div')
  const header = createElement('div')
  const body = createElement('div')
  const sidebar = createElement('div')
  const main = createElement('main')
  const breadcrumb = createElement('div')
  const tabs = createElement('div')
  const content = createElement('div')
  const backdrop = createElement('div')
  const footer = createElement('footer')

  const breakpoint = normalizeBreakpoint(
    readProp(props, 'mobileBreakpoint', DEFAULT_MOBILE_BREAKPOINT)
  )
  const viewport = createKitViewport(breakpoint)
  const sidebarExpanded = readProp(props, 'sidebarExpanded', false)
  const internalCollapsed = state(
    readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) ?? !sidebarExpanded
  )
  const internalMobileOpen = state(readProp<boolean | undefined>(props, 'mobileOpen', undefined) ?? false)
  const collapsed = memo(() => readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) ?? internalCollapsed.value)
  const mobileOpen = memo(() => readProp<boolean | undefined>(props, 'mobileOpen', undefined) ?? internalMobileOpen.value)
  const headerVisible = state(!isProvided(props, 'header'))
  const sidebarVisible = state(isProvided(props, 'sidebar') || hasProp(props, 'menu'))
  const backdropVisible = state(!isProvided(props, 'mobileBackdrop'))
  const breadcrumbVisible = state(false)
  const tabsVisible = state(false)
  const footerVisible = state(false)

  const context: KitLayoutContext = {
    sidebarCollapsed: collapsed,
    mobileOpen,
    isMobile: viewport.isMobile,
    breakpoint,

    toggleSidebar(): void {
      if (viewport.isMobile.value) context.setMobileOpen(!mobileOpen.value)
      else context.setSidebarCollapsed(!collapsed.value)
    },

    setSidebarCollapsed(value: boolean): void {
      if (!isBoolean(value)) throw new Error('VOBS_KIT001: sidebarCollapsed 必须是 boolean')
      if (readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) === undefined) {
        internalCollapsed.value = value
      }
      const handler = readProp<unknown>(props, 'onSidebarCollapsedChange', undefined)
      if (typeof handler === 'function') {
        (handler as KitLayoutProps['onSidebarCollapsedChange'])!(value)
      }
    },

    setMobileOpen(value: boolean): void {
      if (!isBoolean(value)) throw new Error('VOBS_KIT001: mobileOpen 必须是 boolean')
      if (readProp<boolean | undefined>(props, 'mobileOpen', undefined) === undefined) {
        internalMobileOpen.value = value
      }
      const handler = readProp<unknown>(props, 'onMobileOpenChange', undefined)
      if (typeof handler === 'function') (handler as KitLayoutProps['onMobileOpenChange'])!(value)
    }
  }
  provide(KIT_LAYOUT_KEY, context)

  bindClassList(root, props, () => [
    'vobs-kit-layout',
    collapsed.value ? 'vobs-kit-layout--sidebar-collapsed' : undefined,
    viewport.isMobile.value ? 'vobs-kit-layout--mobile' : undefined,
    mobileOpen.value ? 'vobs-kit-layout--mobile-open' : undefined
  ])
  bindCommonAttributes(root, props, [
    'header',
    'sidebar',
    'breadcrumb',
    'tabs',
    'footer',
    'mobileBackdrop',
    'menu',
    'logo',
    'userMenu',
    'headerActions',
    'activeKey',
    'sidebarExpanded',
    'sidebarCollapsed',
    'mobileOpen',
    'sidebarWidth',
    'mobileBreakpoint',
    'sidebarVariant',
    'onSidebarCollapsedChange',
    'onMobileOpenChange',
    'onToggleSidebar',
    'onCloseSidebar'
  ])
  bindUserStyle(root, props, () => {
    const sidebarWidth = readProp<number | undefined>(props, 'sidebarWidth', undefined)
    if (sidebarWidth === undefined) return ''
    return `--vobs-kit-sidebar-width: ${normalizeSidebarWidth(sidebarWidth)}px`
  })
  setAttribute(header, 'class', 'vobs-kit-layout__header')
  insertDynamic(header, null, () => createHeaderSlot(props, context, headerVisible))
  bindVisibility(header, headerVisible)

  setAttribute(body, 'class', 'vobs-kit-layout__body')
  setAttribute(sidebar, 'class', 'vobs-kit-layout__sidebar')
  setAttribute(main, 'class', 'vobs-kit-layout__main')
  setAttribute(breadcrumb, 'class', 'vobs-kit-layout__breadcrumb')
  setAttribute(tabs, 'class', 'vobs-kit-layout__tabs')
  setAttribute(content, 'class', 'vobs-kit-layout__content')

  insertDynamic(sidebar, null, () => createSidebarSlot(props, context, sidebarVisible))
  bindVisibility(sidebar, sidebarVisible)

  insertDynamic(breadcrumb, null, () => createNamedSlot(props, 'breadcrumb', breadcrumbVisible))
  bindVisibility(breadcrumb, breadcrumbVisible)
  insertDynamic(tabs, null, () => createNamedSlot(props, 'tabs', tabsVisible))
  bindVisibility(tabs, tabsVisible)
  if (hasProp(props, 'children')) mountSlot(content, props, 'children')

  insertBefore(main, breadcrumb, null)
  insertBefore(main, tabs, null)
  insertBefore(main, content, null)
  insertBefore(body, sidebar, null)
  insertBefore(body, main, null)

  setAttribute(backdrop, 'class', 'vobs-kit-layout__backdrop')
  insertDynamic(backdrop, null, () => createBackdropSlot(props, context, sidebarVisible, backdropVisible))
  bindVisibility(backdrop, memo(() => backdropVisible.value && sidebarVisible.value && mobileOpen.value))

  setAttribute(footer, 'class', 'vobs-kit-layout__footer')
  insertDynamic(footer, null, () => {
    const value = isProvided(props, 'footer') ? resolveSlot(readProp(props, 'footer', undefined)) : null
    footerVisible.value = value !== null
    return value
  })
  bindVisibility(footer, footerVisible)

  insertBefore(root, header, null)
  insertBefore(root, body, null)
  insertBefore(root, backdrop, null)
  insertBefore(root, footer, null)
  return root
}

function createHeaderSlot(
  props: KitLayoutProps,
  context: KitLayoutContext,
  visible: { value: boolean }
): VobsNode | null {
  if (isProvided(props, 'header')) {
    const value = resolveSlot(readProp(props, 'header', undefined))
    visible.value = value !== null
    return value
  }
  visible.value = true
  return createComponent(KitHeader, {
    get logo() { return readProp(props, 'logo', undefined) },
    get title() { return readProp<string | undefined>(props, 'title', undefined) },
    get headerActions() { return readProp(props, 'headerActions', undefined) },
    get userMenu() { return readProp(props, 'userMenu', undefined) },
    onToggleSidebar: () => {
      context.toggleSidebar()
      const handler = readProp<unknown>(props, 'onToggleSidebar', undefined)
      if (typeof handler === 'function') (handler as KitLayoutProps['onToggleSidebar'])!()
    }
  })
}

function createSidebarSlot(
  props: KitLayoutProps,
  context: KitLayoutContext,
  visible: { value: boolean }
): VobsNode | null {
  if (isProvided(props, 'sidebar')) {
    const value = resolveSlot(readProp(props, 'sidebar', undefined))
    visible.value = value !== null
    return value
  }
  if (!hasProp(props, 'menu')) {
    visible.value = false
    return null
  }
  visible.value = true
  return createComponent(KitSidebar, {
    get menu() { return readProp<readonly KitMenuItem[]>(props, 'menu', []) },
    get collapsed() { return context.sidebarCollapsed.value },
    get mobileOpen() { return context.mobileOpen.value },
    get activeKey() { return readProp<string | undefined>(props, 'activeKey', undefined) },
    get variant() { return readProp<KitSidebarVariant>(props, 'sidebarVariant', 'default') },
    get onSelect() { return readProp<KitLayoutProps['onMenuSelect'] | undefined>(props, 'onMenuSelect', undefined) },
    onClose: () => {
      context.setMobileOpen(false)
      const handler = readProp<unknown>(props, 'onCloseSidebar', undefined)
      if (typeof handler === 'function') (handler as KitLayoutProps['onCloseSidebar'])!()
    }
  })
}

function createNamedSlot(
  props: KitLayoutProps,
  name: 'breadcrumb' | 'tabs',
  visible: { value: boolean }
): VobsNode | null {
  const value = hasProp(props, name) ? resolveSlot(readProp(props, name, undefined)) : null
  visible.value = value !== null
  return value
}

function createBackdropSlot(
  props: KitLayoutProps,
  context: KitLayoutContext,
  sidebarVisible: { value: boolean },
  visible: { value: boolean }
): VobsNode | null {
  if (isProvided(props, 'mobileBackdrop')) {
    const value = resolveSlot(readProp(props, 'mobileBackdrop', undefined))
    visible.value = value !== null
    return value
  }
  if (!sidebarVisible.value) {
    visible.value = false
    return null
  }
  visible.value = true
  const button = createElement('button')
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'class', 'vobs-kit-layout__backdrop-button')
  setAttribute(button, 'aria-label', 'Close navigation')
  insertBefore(button, createText(''), null)
  addEventListener(button, 'click', () => {
    context.setMobileOpen(false)
    const handler = readProp<unknown>(props, 'onCloseSidebar', undefined)
    if (typeof handler === 'function') (handler as KitLayoutProps['onCloseSidebar'])!()
  })
  return button
}

function bindVisibility(node: Element, visible: { value: boolean }): void {
  effect(() => {
    setProperty(node, 'hidden', !visible.value)
    setOptionalAttribute(node, 'aria-hidden', visible.value ? undefined : 'true')
  })
}

function normalizeSidebarWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('VOBS_KIT001: sidebarWidth 必须是大于 0 的有限数字')
  }
  return Math.round(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isProvided(props: object, name: string): boolean {
  return hasProp(props, name) && Reflect.get(props, name) !== undefined
}
