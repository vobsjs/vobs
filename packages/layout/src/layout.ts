import { effect, memo, state } from '@vobs/reactivity'
import { removeAttribute } from '@vobs/runtime'
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

  // The breakpoint is a memo and the viewport receives a getter, so a
  // mobileBreakpoint change actually takes effect
  const breakpoint = memo(() => normalizeBreakpoint(readProp(props, 'mobileBreakpoint', DEFAULT_MOBILE_BREAKPOINT)))
  const viewport = createKitViewport(() => breakpoint.value)
  const sidebarExpanded = readProp(props, 'sidebarExpanded', false)
  const internalCollapsed = state(
    readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) ?? !sidebarExpanded, 'internalCollapsed'
  )
  const internalMobileOpen = state(readProp<boolean | undefined>(props, 'mobileOpen', undefined) ?? false, 'internalMobileOpen')
  const collapsed = memo(() => readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) ?? internalCollapsed.value)
  const mobileOpen = memo(() => readProp<boolean | undefined>(props, 'mobileOpen', undefined) ?? internalMobileOpen.value)
  const headerVisible = state(!isProvided(props, 'header'), 'headerVisible')
  const sidebarVisible = state(isProvided(props, 'sidebar') || hasProp(props, 'menu'), 'sidebarVisible')
  const backdropVisible = state(!isProvided(props, 'mobileBackdrop'), 'backdropVisible')
  const breadcrumbVisible = state(false, 'breadcrumbVisible')
  const tabsVisible = state(false, 'tabsVisible')
  const footerVisible = state(false, 'footerVisible')

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
      if (!isBoolean(value)) throw new Error('VOBS_KIT001: sidebarCollapsed must be a boolean')
      if (readProp<boolean | undefined>(props, 'sidebarCollapsed', undefined) === undefined) {
        internalCollapsed.value = value
      }
      const handler = readProp<unknown>(props, 'onSidebarCollapsedChange', undefined)
      if (typeof handler === 'function') {
        (handler as KitLayoutProps['onSidebarCollapsedChange'])!(value)
      }
    },

    setMobileOpen(value: boolean): void {
      if (!isBoolean(value)) throw new Error('VOBS_KIT001: mobileOpen must be a boolean')
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
  /*
   * "Visible to the user" for the sidebar must take **both desktop visibility
   * and the mobile drawer state** into account.
   *
   * It used to bind only `sidebarVisible`: when the drawer closed on mobile,
   * the sidebar was moved off-screen via CSS classes but was still in the DOM
   * and not `hidden` — its links **remained tabbable** (keyboard users pressed
   * Tab and landed inside invisible navigation). That's exactly "a closed
   * drawer is still tabbable".
   *
   * On desktop `isMobile` is false, so the expression degrades to the original
   * `sidebarVisible` — behavior unchanged.
   */
  bindVisibility(sidebar, memo(() => (
    sidebarVisible.value && (!viewport.isMobile.value || mobileOpen.value)
  )))

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

/**
 * When hidden, move the node **out of the tab order and the accessibility tree**.
 *
 * `hidden` + `aria-hidden` alone are not enough: on mobile the sidebar is
 * **off-screen CSS positioning** (it slides in/out via the
 * `vobs-kit-layout--mobile-open` class on the root, see `:105` in this file).
 * With the drawer closed it's still in the DOM and merely moved out of the
 * viewport — so its links **remained tabbable**: keyboard users pressed Tab and
 * landed inside invisible navigation, and `aria-hidden` doesn't stop keyboard
 * focus either.
 *
 * `inert` was designed exactly for this: it removes the whole subtree from
 * **the focus order and the accessibility tree** at once. On old browsers
 * `inert=""` is just a harmless unknown attribute, while `hidden` /
 * `aria-hidden` keep covering the basics.
 */
function bindVisibility(node: Element, visible: { value: boolean }): void {
  effect(() => {
    setProperty(node, 'hidden', !visible.value)
    setOptionalAttribute(node, 'aria-hidden', visible.value ? undefined : 'true')
    /*
     * Boolean attributes must go through `setAttribute`, not
     * `setOptionalAttribute`: the latter treats **the empty string as "remove"**
     * (`value === '' → removeAttribute`), and `inert=""` is exactly how a
     * boolean attribute **activates** — using it would delete inert outright.
     * When visible, remove it with `removeAttribute`; `inert="false"` still
     * activates, so the value can't express the state.
     */
    if (visible.value) removeAttribute(node, 'inert')
    else setAttribute(node, 'inert', '')
  })
}

function normalizeSidebarWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('VOBS_KIT001: sidebarWidth must be a finite number greater than 0')
  }
  return Math.round(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isProvided(props: object, name: string): boolean {
  return hasProp(props, name) && Reflect.get(props, name) !== undefined
}
