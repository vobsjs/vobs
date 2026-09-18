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
| `prerenderRoutes(options)` | SSG: render each route to HTML at build time (memory-history router per page, guards/loaders fully executed); returns pages with `html`/`head`/`state` — file writing stays with the caller. |
| `renderPage(page, options?)` | Assemble a `PrerenderPage` into a full HTML document (default shell or custom `template`, `entryScript` support). |
| `serializeHeadTags(tags)` | Serialize `HeadTag[]` (title/meta/link) into a `<head>` string with escaping. |
| `applyHead(tags)` | Client-side: apply head tags to `document` (title replace; meta/link reused by identifying key). |
| `createHeadSync(router, headFor)` | Client-side: keep head tags in sync on SPA navigation after hydration; returns an unregister function. |

## Types

SSRRenderer, SSRNode, SSRElement, SSRText, SSRComment, HydrationRenderer, AsyncSSRResult, AsyncSSROptions, SSRState, SSRStateOptions, SSRDebugSnapshot, I18nSSRState, I18nSSRContext, ThemeSSRState, ThemeSSRContext, DictSSRContext, HeadTag, PrerenderPage, PrerenderOptions, PrerenderResult, PrerenderTemplateParts

## SSG (static site generation)

```ts
// scripts/prerender.mjs — build-time, Node only
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prerenderRoutes, renderPage } from '@vobs/ssr'

const result = await prerenderRoutes({
  routes: ['/', '/pricing', '/download'],
  routeRecords: websiteRoutes,               // same records as the client router
  head: path => headMap[path] ?? []          // per-page title/meta/link
})

for (const page of result.pages) {
  const file = join('dist', page.path === '/' ? 'index.html' : page.path, 'index.html')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, renderPage(page, {
    entryScript: '<script type="module" src="/assets/entry.js"></script>'
  }))
}
```

```ts
// Client entry — hydrate the pre-rendered page and keep <head> in sync on navigation
import { hydrate, createHeadSync } from '@vobs/ssr'
import { createRouter } from '@vobs/router'

const router = createRouter({ history: createBrowserHistory(), routes: websiteRoutes })
createHeadSync(router, path => headMap[path] ?? [])
hydrate(() => RouterView({ router }), '#app', { state: window.__VOBS_STATE__ })
```
