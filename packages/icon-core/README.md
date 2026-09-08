# @vobs/icon-core

SVG icon factory for vobs: build icon components from SVG body strings with reactive size, color, and ARIA props. No bundled icon set and no runtime dependency beyond `@vobs/vobs`.

## Install

```bash
npm install @vobs/icon-core
```

## Quick start

```ts
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createSvgIcon } from '@vobs/icon-core'

setRenderer(createDOMRenderer())

const Camera = createSvgIcon({
  name: 'camera',
  body: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>',
  viewBox: '0 0 24 24'
})

const app = createVobs({ render: () => Camera({ size: 48, color: 'red', strokeWidth: 1 }) })

app.mount(document.getElementById('app')!)
```

The component renders a `<span data-icon-name="camera">` wrapping an inline `<svg>`. Without `title` or `aria-label` the icon is treated as decorative (`aria-hidden="true"`); reactive `size` and `title` update the node on the next update pass.

## API

| Signature | Description |
| --- | --- |
| `createIcon<Name>(name, path, viewBox?)` | Builds a path-based `IconDefinition` (`name`, `path`, `viewBox` defaulting to `'0 0 24 24'`) for registries such as the `@vobs/ui` icon set. |
| `createSvgIcon<Name, Props>(definition)` | Returns a reusable icon component. Props: `size`/`width`/`height`, `color`, `stroke`, `strokeWidth`, `fill`, `class`/`className`, `style`, `id`, `title`, `role`, `tabIndex`, `decorative`, plus `aria-*`/`data-*` pass-through. Stale attributes are removed when props change. |
| `createSvgIconNode(source, props?, options?)` | Renders one icon node directly. `source` may be a definition or a getter returning one, so the glyph can be swapped reactively. Options: `class`, `className`, `dataIconName`, `defaultSvgAttributes`. |

## Types

IconDefinition, SvgIconDefinition, VobsIconProps, VobsIconComponent, SvgIconRenderOptions
