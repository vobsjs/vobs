import { createVobs, type VobsConfig, type VobsPlugin } from '@vobs/vobs'
import type { DictDehydratedState } from '@vobs/dict'
import {
  resetDefaultResourceClient,
  type ResourceClient,
  type ResourceDehydratedState,
  type ResourceFailure
} from '@vobs/resource'
import { pushRuntimeDebugContext, setRenderer } from '@vobs/runtime'
import { subscribeHTTPDebug, type HTTPDebugRequest } from '@vobs/http'
import { createSSRRenderer } from './renderer'

/** Async SSR result: HTML plus dehydrated client state. */
export interface AsyncSSRResult {
  readonly html: string
  readonly resources?: ResourceDehydratedState
  readonly dict?: DictDehydratedState
  readonly state?: SSRState
  /**
   * Resources that **failed** during this SSR round (a snapshot of `ResourceClient.errors()`),
   * **present only when non-empty**.
   *
   * Why it exists: `prefetchAll()` deliberately never throws (one failed request must not 500 the
   * whole page), and `dehydrate()` drops failed entries — so the server would quietly return HTML
   * "rendered from incomplete data". With this field, the server can at least log/monitor "this
   * render had failed resources" instead of waiting for the user to notice an empty list.
   */
  readonly failedResources?: readonly ResourceFailure[]
  readonly debug?: SSRDebugSnapshot
}

/** Explicit side-channel for server-only request diagnostics. */
export interface SSRDebugSnapshot {
  readonly version: 1
  readonly environment: 'server'
  readonly startedAt: number
  readonly endedAt: number
  readonly requests: readonly HTTPDebugRequest[]
}

export interface SSRState {
  readonly version: 1
  readonly resources?: ResourceDehydratedState
  readonly dict?: DictDehydratedState
  readonly i18n?: I18nSSRState
  readonly theme?: ThemeSSRState
}

export interface I18nSSRState {
  readonly version: 1
  readonly locale: string
  readonly messages: Readonly<Record<string, unknown>>
}

export interface ThemeSSRState {
  readonly mode: 'light' | 'dark' | 'system'
  readonly overrides: Readonly<Record<string, unknown>>
  readonly version: 1
}

export interface I18nSSRContext {
  dehydrate(): I18nSSRState
  hydrate(snapshot: unknown): void
}

export interface ThemeSSRContext {
  dehydrate(): ThemeSSRState
  hydrate(snapshot: unknown): void
}

export interface DictSSRContext {
  dehydrate(): DictDehydratedState
  hydrate(snapshot: unknown): void
}

export interface SSRStateOptions {
  readonly resourceClient?: ResourceClient
  readonly dict?: DictSSRContext
  readonly i18n?: I18nSSRContext
  readonly theme?: ThemeSSRContext
}

export interface AsyncSSROptions extends SSRStateOptions {
  plugins?: VobsPlugin[]
  readonly debug?: {
    /** Capture Vobs HTTP events and return them for an explicit client import. */
    readonly captureRequests?: boolean
  }
  /**
   * Maximum rounds for async SSR to flush until "the render result stops changing" (default 10).
   * Covers the case where "after data arrives, several more hops of async work were queued";
   * setting 1 falls back to the old single-update behavior.
   */
  readonly maxFlushRounds?: number
}

export function renderToString(
  render: VobsConfig['render'],
  options: { plugins?: VobsPlugin[] } = {}
): string {
  const ssr = createSSRRenderer()
  const app = createVobs({
    render,
    renderer: ssr.renderer,
    plugins: options.plugins
  })

  try {
    app.mount(ssr.container)
    return ssr.toHTML()
  } finally {
    app.destroy()
  }
}

export async function renderToStringAsync(
  render: VobsConfig['render'],
  options: AsyncSSROptions = {}
): Promise<AsyncSSRResult> {
  const ssr = createSSRRenderer()
  const app = createVobs({
    render,
    renderer: ssr.renderer,
    plugins: options.plugins
  })
  const captureRequests = options.debug?.captureRequests === true
  const requests: HTTPDebugRequest[] = []
  const startedAt = Date.now()
  const stopDebug = captureRequests ? subscribeHTTPDebug(event => {
    requests.push({
      ...event,
      context: { environment: 'server', ...event.context }
    })
  }) : () => undefined
  const restoreDebugContext = captureRequests
    ? pushRuntimeDebugContext({ environment: 'server' })
    : () => undefined

  try {
    app.mount(ssr.container)
    await options.resourceClient?.prefetchAll()
    /*
     * `setRenderer` is a process-level singleton with no async context: during the await above,
     * another renderToString / renderToStringAsync may already have installed its own renderer.
     * Re-install our own copy before flushing — otherwise this update would write our tree with
     * someone else's renderer.
     * Remaining limitation: when two async renders truly interleave, it is still "last installed
     * wins"; a complete fix requires carrying the renderer per owner.
     */
    setRenderer(ssr.renderer)
    /*
     * Flush until **stable**, not just a single update.
     *
     * `await prefetchAll()` only resolves the first hop: after data arrives, the binding effects may
     * still hold chained promises/`await`s, or this write may trigger new effects — those need a few
     * more rounds of microtasks to become ready. A single `app.update()` leaves them **silently
     * missing** (the HTML keeps placeholders or stale values, with no error and no lead).
     *
     * The loop criterion is "the render result stops changing" (not a fixed count), with an upper
     * bound to prevent infinite loops; every round re-installs our own renderer (`setRenderer` is a
     * process-level singleton and may have been swapped during the await).
     */
    const maxFlushRounds = Math.max(1, options.maxFlushRounds ?? 10)
    let previousHTML = ''
    for (let round = 0; round < maxFlushRounds; round += 1) {
      setRenderer(ssr.renderer)
      app.update()
      const html = ssr.toHTML()
      if (html === previousHTML) break
      previousHTML = html
      // Let queued async work advance one round (macrotask: release the whole queued microtask chain)
      await new Promise(resolve => { setTimeout(resolve, 0) })
    }
    const endedAt = Date.now()
    // `errors` is the later-added read-only view; optional call keeps compatibility with old stubs/clients
    const failedResources = options.resourceClient?.errors?.() ?? []
    return {
      html: ssr.toHTML(),
      resources: options.resourceClient?.dehydrate(),
      dict: options.dict?.dehydrate(),
      state: createState(options),
      ...(failedResources.length > 0 ? { failedResources } : {}),
      debug: captureRequests ? {
        version: 1,
        environment: 'server',
        startedAt,
        endedAt,
        requests
      } : undefined
    }
  } finally {
    restoreDebugContext()
    stopDebug()
    /*
     * The process-level default client must be reset at the end of every render.
     *
     * The `resource()` function API uses `@vobs/resource`'s **module-level** client, which has
     * nothing to do with this request: not clearing it means the next request (or the next
     * prerender round in the same process) reuses it as-is.
     * Measured probe `probe-audit-ssr-2.test.mjs` H5/H6: rendering users "alice" then "bob" in a
     * row, the second render's output and `dehydrate()` both contained **alice**, and the fetcher
     * was called only once — i.e. the previous user's data was shipped to the next page inside the
     * dehydrated snapshot.
     *
     * Placed in finally so that "even a throwing render does not leave a dirty cache for the next
     * request". A caller-supplied `options.resourceClient` is left alone — its lifecycle is owned
     * by the caller.
     */
    resetDefaultResourceClient()
    app.destroy()
  }
}

export function createState(options: SSRStateOptions): SSRState {
  return {
    version: 1,
    resources: options.resourceClient?.dehydrate(),
    dict: options.dict?.dehydrate(),
    i18n: options.i18n?.dehydrate(),
    theme: options.theme?.dehydrate()
  }
}

export function serializeState(state: SSRState): string {
  const serialized = JSON.stringify(state)
  return serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function parseState(snapshot: unknown): SSRState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs SSR: initial state is not valid JSON')
    }
  }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    throw new Error('Vobs SSR: initial state version or format is invalid')
  }
  const state = value as SSRState
  if (state.i18n !== undefined) validateI18nState(state.i18n)
  return state
}

function validateI18nState(value: I18nSSRState): void {
  if (!value || typeof value !== 'object' || value.version !== 1
    || typeof value.locale !== 'string' || !value.locale.trim()
    || !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages)) {
    throw new Error('Vobs SSR: i18n initial state version or format is invalid')
  }
  for (const [locale, messages] of Object.entries(value.messages)) {
    if (!locale.trim() || !isMessageObject(messages)) throw new Error('Vobs SSR: i18n messages format is invalid')
  }
}

function isMessageObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(entry => typeof entry === 'string' || isMessageObject(entry))
}
