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
| `renderToStringAsync(render, options?)` | Await `resourceClient.prefetchAll()`, then flush until the HTML stops changing (`options.maxFlushRounds`, default 10), and return an `AsyncSSRResult` with `html`, dehydrated `resources`/`dict`, `state`, `failedResources` (only when some prefetch failed), and an optional server request `debug` snapshot (`debug.captureRequests`). |
| `hydrate(render, target, options?)` | Reuse the server-rendered DOM, restore dehydrated state, and return the mounted `VobsApp<Node>`. `options.strictHydration` rejects a provisional claim of non-empty server text instead of only emitting a debug event. |
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

## Hydration strictness

When the server rendered non-empty text while the client wants an empty text node (a bare `createText('')` that a binding effect overwrites later), hydration can only claim that text provisionally. By default it does so and emits a `hydrationProvisionalText` runtime debug event; with `strictHydration: true` it throws a `HydrationMismatchError` instead (`vobsHydration.kind === 'content'`, `actual` carrying the server text). The normal empty case — server text serialized as a `<!---->` placeholder comment — is unaffected.

```ts
// Client — reject a silently replaced value instead of debugging it later
hydrate(render, '#app', { state: window.__VOBS_STATE__, strictHydration: true })
```

## Async SSR flushing and failures

`renderToStringAsync` awaits `prefetchAll()`, then keeps rendering until the HTML stops changing (bounded by `maxFlushRounds`, default 10). Content written one asynchronous hop after the data arrives — a timer or a second request inside a binding effect — therefore still lands in the final HTML. `maxFlushRounds: 1` restores the old single-`update()` behavior.

`prefetchAll()` deliberately never rejects and `dehydrate()` drops failed entries, so a page can be rendered from partial data without any signal. The result surfaces that as `failedResources` — a snapshot of `resourceClient.errors()` (`{ key, error }`) — present only when non-empty, so a healthy render keeps its previous result shape.

```ts
const result = await renderToStringAsync(render, { resourceClient, maxFlushRounds: 10 })
if (result.failedResources) console.warn('SSR rendered from partial data', result.failedResources)
```

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
