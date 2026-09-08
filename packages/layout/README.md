# @vobs/layout

App-shell primitives for vobs applications: a `KitLayout` shell with header, sidebar, menu, breadcrumb, and tabs slots, responsive mobile behavior, and a shared layout context.

## Install

```bash
npm install @vobs/layout
```

## Quick start

```ts
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitLayout } from '@vobs/layout'

setRenderer(createDOMRenderer())

const app = createVobs({
  render: () => createComponent(KitLayout, {
    title: 'Workspace',
    menu: [{ key: '/home', label: 'Home' }],
    children: 'Content'
  })
})

app.mount(document.getElementById('app')!)
```

The shell renders the default header (with a sidebar toggle), sidebar, menu, and content slot. The sidebar starts collapsed unless `sidebarExpanded` is set; below `mobileBreakpoint` (default 768) a resize listener switches the root to the mobile variant, and the listener is removed on destroy.

## API

| Signature | Description |
| --- | --- |
| `KitLayout(props: KitLayoutProps)` | Shell with `header`, `sidebar`, `menu`, `breadcrumb`, `tabs`, `footer`, and `mobileBackdrop` slots; passing `null` to a slot drops the default region. Sidebar state is uncontrolled by default or controlled via `sidebarCollapsed` + `onSidebarCollapsedChange`; `mobileOpen`/`onMobileOpenChange` control the mobile drawer. |
| `KitHeader(props: KitHeaderProps)` | Header bar with `logo`, `title`, sidebar toggle, `userMenu`, and `headerActions`. |
| `KitSidebar(props: KitSidebarProps)` | Collapsible sidebar rendering menu `items` with `activeKey`, `variant`, mobile `closeLabel`, and `footer`. |
| `KitMenu(props: KitMenuProps)` | Menu tree from `KitMenuItem` entries (`icon`, `badge`, `href`, `permission`, nested `children`), with `collapsed` and `activeKey`. |
| `KitBreadcrumb(props: KitBreadcrumbProps)` | Breadcrumb from `KitBreadcrumbItem` entries with `separator` and `onNavigate`. |
| `KitTabs(props: KitTabsProps)` | Tab strip from `KitTabItem` entries with `value`/`activeKey`, `closable`, and `onSelect`/`onChange`/`onClose`. |
| `useKitLayout(): KitLayoutContext` | Returns the surrounding layout context (throws outside `KitLayout`): `sidebarCollapsed`, `mobileOpen`, `isMobile` signals plus `toggleSidebar()`, `setSidebarCollapsed()`, `setMobileOpen()`. |
| `createKitViewport(breakpoint?)` | Standalone `KitViewport` with `width`/`height`/`isMobile` signals and `dispose()`; stops listening after disposal. |
| `normalizeBreakpoint(value)` | Validates and rounds a breakpoint; throws on non-finite or non-positive values. |
| `DEFAULT_MOBILE_BREAKPOINT` | `768`. |

## Types

LayoutAttributeValue, LayoutChild, LayoutChildren, LayoutCommonProps, KitMenuItem, KitSidebarVariant, KitLayoutProps, KitHeaderProps, KitSidebarProps, KitMenuProps, KitBreadcrumbItem, KitBreadcrumbProps, KitTabItem, KitTabsProps, KitReadonlySignal, KitLayoutContext, KitViewport
