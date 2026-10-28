// SSG prerender: render every route into complete HTML at build time (building block layer; it
// never touches the filesystem — writing to disk is the caller script's job, keeping this package
// isomorphic and pure).
// Design: for each target path, create the Router with a "placeholder boot path", then push the
// real path so guards/loaders fully execute (a same-path push would be skipped by the router's
// dedup, and loaders would never run).
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type RouteRecord,
  type Router
} from '@vobs/router'
import type { VobsNode, VobsPlugin } from '@vobs/vobs'
import { escapeAttribute, escapeHTML, isSafeAttributeName } from './renderer'
import { renderToStringAsync, serializeState, type SSRDebugSnapshot, type SSRState, type SSRStateOptions } from './render'

/* ---------- Head management ---------- */

/** SEO tag: title uses text; meta/link use attrs (name/property/content etc.) */
export type HeadTag =
  | { readonly tag: 'title'; readonly text: string }
  | { readonly tag: 'meta'; readonly attrs: Readonly<Record<string, string>> }
  | { readonly tag: 'link'; readonly attrs: Readonly<Record<string, string>> }

/** Serialize head tags into a string (for server-side <head> injection; both text and attributes are escaped) */
export function serializeHeadTags(tags: readonly HeadTag[]): string {
  const parts: string[] = []
  for (const item of tags) {
    if (item.tag === 'title') {
      parts.push(`<title>${escapeHTML(item.text)}</title>`)
    } else {
      parts.push(`<${item.tag}${serializeAttrs(item.attrs)}>`)
    }
  }
  return parts.join('')
}

function serializeAttrs(attrs: Readonly<Record<string, string>>): string {
  let html = ''
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue
    // Attribute names cannot be escaped (HTML has no name entities), only rejected — see renderer.isSafeAttributeName
    if (!isSafeAttributeName(key)) continue
    html += ` ${key}="${escapeAttribute(String(value))}"`
  }
  return html
}

/** Client: apply head tags to the document (title replaced directly; meta/link reuse existing elements by "identifying key") */
export function applyHead(tags: readonly HeadTag[]): void {
  if (typeof document === 'undefined') return
  for (const item of tags) {
    if (item.tag === 'title') {
      document.title = item.text
      continue
    }
    const existing = findHeadElement(item.tag, item.attrs)
    const element = existing ?? document.head.appendChild(document.createElement(item.tag))
    for (const [key, value] of Object.entries(item.attrs)) {
      if (value !== undefined && value !== null) element.setAttribute(key, value)
    }
  }
}

/** Identifying key: decides whether two meta/link tags are the same logical tag (meta by name/property etc., link by rel) */
function findHeadElement(
  tag: 'meta' | 'link',
  attrs: Readonly<Record<string, string>>
): HTMLMetaElement | HTMLLinkElement | null {
  const identifying = (tag === 'meta' ? ['name', 'property', 'http-equiv', 'charset'] : ['rel'])
    .filter(key => attrs[key] !== undefined)
  if (identifying.length === 0) return null
  for (const node of Array.from(document.head.querySelectorAll(tag))) {
    if (identifying.every(key => node.getAttribute(key) === attrs[key])) {
      return node as HTMLMetaElement | HTMLLinkElement
    }
  }
  return null
}

/** Client: sync the head on route changes (SPA navigation after SSG hydration; returns an unsubscribe function) */
export function createHeadSync(
  router: Router,
  headFor: (path: string) => readonly HeadTag[]
): () => void {
  return router.beforeEach(to => {
    applyHead(headFor(to.path))
  })
}

/* ---------- Prerender ---------- */

export interface PrerenderPage {
  /** Requested path (the original value from options.routes) */
  readonly path: string
  /** The real route fullPath after navigation completes (may differ from path after guard redirects) */
  readonly fullPath: string
  /** Rendered result inside <div id="app"> (excluding the shell) */
  readonly html: string
  /** Serialized <head> tag string */
  readonly head: string
  /** Dehydrated state (passed to renderPage for __VOBS_STATE__ injection) */
  readonly state?: SSRState
}

export interface PrerenderTemplateParts {
  readonly head: string
  readonly body: string
  readonly state: string
}

export interface PrerenderOptions extends SSRStateOptions {
  /** Route list to prerender, e.g. ['/', '/pricing', '/download'] */
  readonly routes: readonly string[]
  /** Site route table (same shape as createRouter's routes) */
  readonly routeRecords: readonly RouteRecord[]
  /** Site-wide root component; default () => RouterView({ router }) */
  readonly render?: (router: Router) => VobsNode
  /** Per-page SEO tags */
  readonly head?: (path: string) => readonly HeadTag[]
  /** Extra plugins (i18n/theme etc.) */
  readonly plugins?: VobsPlugin[]
  /** Request diagnostics side-channel */
  readonly debug?: { readonly captureRequests?: boolean }
}

export interface PrerenderResult {
  readonly pages: readonly PrerenderPage[]
  readonly debug?: SSRDebugSnapshot
}

/**
 * Render page by page at build time: returns each page's render result + head + dehydrated state
 * (writes no files).
 * Typical usage: in a build script, loop renderPage(page) and writeFile to dist/<path>/index.html.
 */
export async function prerenderRoutes(options: PrerenderOptions): Promise<PrerenderResult> {
  const pages: PrerenderPage[] = []
  let debug: SSRDebugSnapshot | undefined

  for (const path of options.routes) {
    // Placeholder boot path: guarantees the target page's guards/loaders fully execute (a same-path push would be deduped)
    const router = createRouter({
      history: createMemoryHistory('/__vobs_boot__'),
      routes: options.routeRecords
    })
    try {
      const target = await router.push(path)
      if (target === false) {
        throw new Error(`Vobs SSR: prerender of ${path} was cancelled by a navigation guard`)
      }
      const render = options.render ?? ((instance: Router) => RouterView({ router: instance }))
      const result = await renderToStringAsync(() => render(router), {
        plugins: options.plugins,
        resourceClient: options.resourceClient,
        dict: options.dict,
        i18n: options.i18n,
        theme: options.theme,
        debug: options.debug
      })
      pages.push({
        path,
        fullPath: target.fullPath,
        html: result.html,
        head: serializeHeadTags(options.head?.(path) ?? []),
        state: result.state
      })
      if (result.debug !== undefined) debug = result.debug
    } finally {
      router.destroy()
    }
  }

  return { pages, debug }
}

/** Assembles a PrerenderPage into a complete HTML document (minimal shell by default; template can fully customize the page) */
export function renderPage(
  page: PrerenderPage,
  options: {
    /** Client entry script (e.g. <script type="module" src="/assets/entry.js"></script>) */
    readonly entryScript?: string
    /** Custom shell; default <!doctype html><html><head>…</head><body>…</body></html> */
    readonly template?: (parts: PrerenderTemplateParts) => string
  } = {}
): string {
  const head = page.head
  const state = serializeState(page.state ?? { version: 1 })
  const body = `<div id="app">${page.html}</div>` +
    `<script>window.__VOBS_STATE__=${state}</script>` +
    `${options.entryScript ?? ''}`
  return options.template
    ? options.template({ head, body, state })
    : `<!doctype html><html><head><meta charset="UTF-8">${head}</head><body>${body}</body></html>`
}
