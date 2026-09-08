# @vobs/kit

High-level page building blocks for vobs admin apps: the `@vobs/layout` shell components re-exported, plus page scaffolds that assemble `@vobs/table` resources with auth, router, i18n, and theme contexts.

## Install

```bash
npm install @vobs/kit
```

## Quick start

```ts
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitPage } from '@vobs/kit'

setRenderer(createDOMRenderer())

const app = createVobs({
  render: () => createComponent(KitPage, {
    title: 'Users',
    description: 'Manage users',
    actions: 'Create',
    toolbar: 'Filter controls',
    children: 'Table content'
  })
})

app.mount(document.getElementById('app')!)
```

## API

| Signature | Description |
| --- | --- |
| `KitPage(props: KitPageProps)` | Page scaffold: title/description/actions header (fully replaceable via `header`), a `toolbar` region above `children`, and no UI-library dependency. |
| `KitPageHeader(props: KitPageHeaderProps)` | Standalone page header row with `title`, `description`, and `actions`. |
| `KitPageActions(props: KitPageActionsProps)` | Action row for page-level operations; `align` is `'start' \| 'center' \| 'end' \| 'between'`. |
| `KitFilterBar(props: KitFilterBarProps)` | `<form role="search">` with default Search/Reset buttons (`searchLabel`/`resetLabel`), `onSearch`/`onReset`, and an `actions` slot; field state and query serialization stay with the caller. |
| `KitResourcePage<Row>(props: KitResourcePageProps<Row>)` | Full resource page: a `KitDataTable` bound to `resource` + `columns` inside a `KitPage`. When `requiredPermission` or `requiredRole` is set, access is checked against the `auth` context and `unauthorized` content replaces the table on failure. Optional `router`, `i18n`, and `theme` contexts wire route boundaries and loading/empty labels; `tableProps` passes through table options and `table` replaces the table entirely. |
| Re-exports from `@vobs/layout` | `KitLayout`, `KitHeader`, `KitSidebar`, `KitMenu`, `KitBreadcrumb`, `KitTabs`, `KIT_LAYOUT_KEY`, `useKitLayout`, `createKitViewport`, `DEFAULT_MOBILE_BREAKPOINT`, `normalizeBreakpoint`. |

## Types

KitPageProps, KitPageHeaderProps, KitPageActionsProps, KitPageActionsAlign, KitFilterBarProps, KitResourcePageProps, KitLayoutOptions, KitLayoutProps, KitHeaderProps, KitSidebarProps, KitSidebarVariant, KitMenuProps, KitMenuItem, KitBreadcrumbProps, KitBreadcrumbItem, KitTabsProps, KitTabItem, KitLayoutContext, KitLayoutProps, KitReadonlySignal, KitViewport, LayoutAttributeValue, LayoutChild, LayoutChildren, LayoutCommonProps
