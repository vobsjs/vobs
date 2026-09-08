# @vobs/ui

Signal-driven component library for the vobs framework: run-once components compiled from JSX by `@vobs/vite-plugin`, styled through the `vui-` class contract, with portal-based overlays and focus management.

## Install

```bash
npm install @vobs/ui
```

## Quick start

```ts
import { state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Dialog } from '@vobs/ui'

setRenderer(createDOMRenderer())

const open = state(true)

const app = createVobs({
  render: () => createComponent(Dialog, {
    get open() { return open.value },
    title: 'Confirm',
    onClose: reason => { open.value = false },
    children: 'Delete this item?'
  })
})

app.mount(document.getElementById('app')!)
```

The surface renders inside the component placeholder by default and through a portal when `portal`/`portalTarget` are provided. `onClose` receives a `DialogCloseReason` (`'close-button' | 'backdrop' | 'escape'`); Escape closes the surface while `closeOnEscape` is not disabled.

## API

| Signature | Description |
| --- | --- |
| `Button(props?: ButtonProps)` | Button with reactive `disabled`/`loading` (`aria-busy`), `variant`, external `icon` and `children` nodes. `ButtonGroup(props?)` groups related buttons. |
| `Input(props?)`, `Textarea(props?)`, `Select(props?)`, `Checkbox(props?)`, `Radio(props?)`, `Switch(props?)` | Form controls wired to a controlled `value` plus `onInput`/`onChange` callbacks. |
| `Card(props?)`, `CardHeader(props?)` | Content container with `title` and `description` slots. |
| `Tag(props?)`, `Alert(props?)`, `Avatar(props?)`, `Kbd(props?)`, `KbdCombo(props?)`, `KbdRow(props?)` | Presentational components with tone and size props. |
| `Tabs(props: TabsProps)` | Tab bar and panels; uncontrolled activation updates and notifies via `onChange`. |
| `Dialog(props?)`, `Drawer(props?)` | Modal surfaces: `aria-modal`, portal mounting, close-button/backdrop/Escape close reasons. |
| `Menu(props?)`, `MenuDivider(props?)`, `NavList(props?)`, `Pagination(props?)`, `PageHeader(props?)`, `PageHeaderAction(props?)` | Navigation and page furniture. |
| `Table<Row>(props?)`, `TablePanel<Row>(props?)` | Base table rendering; `@vobs/table` builds its data table on top. |
| `StatCard(props?)`, `StatCardGrid(props?)`, `ActivityRail(props?)`, `FileTree(props?)`, `EditorTabs(props?)`, `WorkbenchTitlebar(props?)`, `StatusBar(props?)`, `ChatComposer(props?)` | Workbench-style building blocks. |
| `ToastHost(props?)` | Toast viewport with `ToastPosition`. |
| `createPortal(node, adapter, target)` | Mounts `node` outside the component placeholder; unmounts when the owning component is disposed. |
| `createDOMPortalAdapter()` | `VuiPortalAdapter` that appends and removes DOM nodes. |
| `createFocusTrap(root, options?)` | Cycles Tab within `root` and restores the previously focused element on `deactivate()`. Options: `initialFocus`, `restoreFocus`, `onEscape`. |
| `createOverlayManager()` | Overlay stack of `OverlayEntry` items with `open`, `close`, `bringToFront`, `subscribe`, and `entries`. |
| `Icon(props?)` | Built-in SVG icon by `name` with `size`/`title`; `createIcon`, `registerIcon`, `resolveIcon`, and `VUI_ICON_PATHS` manage the definition registry backed by `@vobs/icon-core`. |

Components accept plain values, signals, or getters for reactive props, and merge consumer `class`/`className` into the `vui-` class list without leaking it to inner elements.

## Types

ButtonProps, ButtonVariant, ButtonGroupProps, ControlSize, ChoiceProps, InputProps, InputType, SelectProps, SwitchProps, TextareaProps, CardProps, CardHeaderProps, TagProps, TagTone, AlertProps, AlertTone, TabItem, TabsProps, DialogCloseReason, DialogProps, MenuItem, MenuProps, NavGroup, NavItem, NavListProps, PaginationProps, AvatarProps, AvatarShape, AvatarSize, PageHeaderActionProps, PageHeaderProps, TableAlign, TableColumn, TablePanelProps, TableProps, StatCardGridProps, StatCardProps, StatDeltaDirection, KbdComboProps, KbdProps, KbdRowProps, ActivityRailItem, ActivityRailProps, FileTreeItem, FileTreeItemKind, FileTreeProps, EditorTabItem, EditorTabsProps, WorkbenchTitlebarProps, StatusBarDot, StatusBarItem, StatusBarProps, ChatComposerProps, DrawerCloseReason, DrawerProps, ToastHostProps, ToastPosition, FocusTrapHandle, FocusTrapOptions, OverlayEntry, OverlayManager, VuiPortalAdapter, IconDefinition, IconProps, VuiAttributeValue, VuiChildren, VuiCommonProps, VuiEventHandler
