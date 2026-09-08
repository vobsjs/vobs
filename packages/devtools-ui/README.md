# @vobs/devtools-ui

Panel UI for `@vobs/devtools`, packaged as ready-to-use Vobs components.

## Install

```bash
npm install @vobs/devtools-ui
```

## Quick start

```ts
import { createDOMRenderer } from '@vobs/dom'
import { createComponent, createVobs } from '@vobs/vobs'
import { DevToolsWidget } from '@vobs/devtools-ui'

const app = createVobs({
  render: () => createComponent(DevToolsWidget, {}),
  renderer: createDOMRenderer()
})
app.mount(document.body)
```

## API

| Signature | Description |
| --- | --- |
| `DevToolsWidget(props?)` | Floating launcher that opens the inspector panel in a dialog; `props.label` overrides the button label. |
| `DevToolsPanel(props)` | Full inspector (component tree, signals, effects, updates, lifecycle, network, errors); props: `api`, `router`, `http`, `query`, `toolbarPlacement`. |
| `readDevToolsSnapshot(api?)` | Read a `DevToolsSnapshot` from the given `DevToolsAPI`, or from the active one returned by `getDevTools()`. |

## Types

DevToolsPanelProps, DevToolsSnapshot, DevToolsWidgetProps
