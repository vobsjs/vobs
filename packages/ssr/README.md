# @vobs/ssr

String renderer and hydration adapter for server-side rendering of Vobs applications.

## Install

```bash
npm install @vobs/ssr
```

## Quick start

```ts
// Server
import { renderToStringAsync, serializeState } from '@vobs/ssr'

const result = await renderToStringAsync(render, { resourceClient })
const page = `<!doctype html>
<div id="app">${result.html}</div>
<script>window.__VOBS_STATE__ = ${serializeState(result.state)}</script>`
```

```ts
// Client
import { hydrate } from '@vobs/ssr'

const app = hydrate(render, '#app', { state: window.__VOBS_STATE__, resourceClient })
```

## API

| Signature | Description |
| --- | --- |
| `renderToString(render, options?)` | Render synchronously to an HTML string; `options.plugins` accepts `VobsPlugin[]`. |
| `renderToStringAsync(render, options?)` | Await `resourceClient.prefetchAll()`, then return an `AsyncSSRResult` with `html`, dehydrated `resources`/`dict`, `state`, and an optional server request `debug` snapshot (`debug.captureRequests`). |
| `hydrate(render, target, options?)` | Reuse the server-rendered DOM, restore dehydrated state, and return the mounted `VobsApp<Node>`. |
| `createState(options)` | Build an `SSRState` from resource/dict/i18n/theme contexts. |
| `serializeState(state)` | JSON-encode an `SSRState` for inline embedding (escapes `<`, `>`, `&`, and line separators). |
| `parseState(snapshot)` | Validate and parse a string or object snapshot back into an `SSRState`. |
| `createSSRRenderer()` | Low-level string renderer; mount into `ssr.container` and serialize with `ssr.toHTML()`. |
| `createHydrationRenderer(container)` | Low-level renderer that adopts existing DOM; pass `hydration.renderer` to `createVobs` and call `app.hydrate(container)`. |

## Types

SSRRenderer, SSRNode, SSRElement, SSRText, SSRComment, HydrationRenderer, AsyncSSRResult, AsyncSSROptions, SSRState, SSRStateOptions, SSRDebugSnapshot, I18nSSRState, I18nSSRContext, ThemeSSRState, ThemeSSRContext, DictSSRContext
