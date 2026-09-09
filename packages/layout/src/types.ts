import type { ReadableSignal, Signal } from '@vobs/reactivity'
import type { VobsNode } from '@vobs/vobs'

export type LayoutAttributeValue = string | number | boolean | undefined

export type LayoutChild = VobsNode | string | number | null | undefined | false

export type LayoutChildren =
  | LayoutChild
  | readonly LayoutChildren[]
  | (() => LayoutChildren)

export interface LayoutCommonProps {
  readonly class?: string
  readonly className?: string
  readonly style?: string
  readonly id?: string
  readonly title?: string
  readonly role?: string
  readonly tabIndex?: number
  readonly children?: LayoutChildren
  readonly [name: `aria-${string}`]: LayoutAttributeValue
  readonly [name: `data-${string}`]: LayoutAttributeValue
}

export interface KitMenuItem {
  readonly key: string
  readonly label: string
  readonly icon?: LayoutChildren
  readonly badge?: LayoutChildren
  readonly href?: string
  readonly target?: string
  readonly rel?: string
  readonly permission?: string
  readonly disabled?: boolean
  readonly children?: readonly KitMenuItem[]
}

export type KitSidebarVariant = 'default' | 'centered'

export interface KitLayoutProps extends LayoutCommonProps {
  readonly header?: LayoutChildren
  readonly sidebar?: LayoutChildren
  readonly breadcrumb?: LayoutChildren
  readonly tabs?: LayoutChildren
  readonly footer?: LayoutChildren
  readonly mobileBackdrop?: LayoutChildren
  readonly menu?: readonly KitMenuItem[]
  readonly logo?: LayoutChildren
  readonly title?: string
  readonly userMenu?: LayoutChildren
  readonly headerActions?: LayoutChildren
  readonly activeKey?: string
  /** Whether the sidebar starts expanded when no controlled collapsed state is provided. */
  readonly sidebarExpanded?: boolean
  readonly sidebarCollapsed?: boolean
  readonly mobileOpen?: boolean
  readonly sidebarWidth?: number
  readonly mobileBreakpoint?: number
  readonly sidebarVariant?: KitSidebarVariant
  readonly onSidebarCollapsedChange?: (collapsed: boolean) => void
  readonly onMobileOpenChange?: (open: boolean) => void
  readonly onToggleSidebar?: () => void
  readonly onCloseSidebar?: () => void
  readonly onMenuSelect?: (key: string, item: KitMenuItem) => void
}

export interface KitHeaderProps extends LayoutCommonProps {
  readonly logo?: LayoutChildren
  readonly title?: string
  readonly sidebarToggle?: LayoutChildren
  readonly userMenu?: LayoutChildren
  readonly headerActions?: LayoutChildren
  readonly toggleLabel?: string
  readonly onToggleSidebar?: () => void
}

export interface KitSidebarProps extends LayoutCommonProps {
  readonly items?: readonly KitMenuItem[]
  readonly menu?: readonly KitMenuItem[]
  readonly collapsed?: boolean
  readonly mobileOpen?: boolean
  readonly activeKey?: string
  readonly variant?: KitSidebarVariant
  readonly closeLabel?: string
  readonly footer?: LayoutChildren
  readonly onSelect?: (key: string, item: KitMenuItem) => void
  readonly onClose?: () => void
}

export interface KitMenuProps extends LayoutCommonProps {
  readonly items: readonly KitMenuItem[]
  readonly collapsed?: boolean
  readonly activeKey?: string
  readonly onSelect?: (key: string, item: KitMenuItem) => void
}

export interface KitBreadcrumbItem {
  readonly key?: string
  readonly label: string
  readonly href?: string
  readonly disabled?: boolean
}

export interface KitBreadcrumbProps extends LayoutCommonProps {
  readonly items: readonly KitBreadcrumbItem[]
  readonly separator?: LayoutChildren
  readonly onNavigate?: (item: KitBreadcrumbItem, index: number) => void
}

export interface KitTabItem {
  readonly id: string
  readonly label: string
  readonly href?: string
  readonly icon?: LayoutChildren
  readonly disabled?: boolean
  readonly closable?: boolean
}

export interface KitTabsProps extends LayoutCommonProps {
  readonly tabs?: readonly KitTabItem[]
  readonly items?: readonly KitTabItem[]
  readonly value?: string
  readonly activeKey?: string
  readonly closable?: boolean
  readonly onSelect?: (tab: KitTabItem) => void
  readonly onChange?: (id: string, tab: KitTabItem) => void
  readonly onClose?: (tab: KitTabItem) => void
}

export interface KitReadonlySignal<T> {
  readonly value: T
}

export interface KitLayoutContext {
  readonly sidebarCollapsed: KitReadonlySignal<boolean>
  readonly mobileOpen: KitReadonlySignal<boolean>
  readonly isMobile: KitReadonlySignal<boolean>
  readonly breakpoint: number
  toggleSidebar(): void
  setSidebarCollapsed(value: boolean): void
  setMobileOpen(value: boolean): void
}

export interface KitViewport {
  readonly width: Signal<number>
  readonly height: Signal<number>
  /** memo 派生值，只读。 */
  readonly isMobile: ReadableSignal<boolean>
  dispose(): void
}
