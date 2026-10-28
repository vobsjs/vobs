import { state, getCurrentOwner, type ReadableSignal } from '@vobs/reactivity'
import {
  createComponent,
  createElement,
  createFragment,
  createInjectionKey,
  inject,
  insertBoundary,
  type InjectionKey,
  type VobsNode,
  type VobsPlugin
} from '@vobs/vobs'
import {
  createRouterDebugId,
  emitRouterDebug
} from './debug'
import {
  addEventListener,
  createText,
  getRuntimeDebugContext,
  insertBefore,
  runWithRuntimeDebugContext,
  setAttribute,
  type RuntimeDebugContext
} from '@vobs/runtime'

export { createRouterDebugId, emitRouterDebug, subscribeRouterDebug } from './debug'
export type { RouterDebugEvent, RouterDebugEventType } from './debug'

export type RouteParams = Readonly<Record<string, string>>
export type RouteQueryValue = string | readonly string[]
export type RouteQuery = Readonly<Record<string, RouteQueryValue>>
export type RouteMeta = Readonly<Record<string, unknown>>

export interface RouteLocation {
  readonly path: string
  readonly fullPath: string
  readonly params: RouteParams
  readonly query: RouteQuery
  readonly hash: string
  readonly name: string | undefined
  readonly meta: RouteMeta
  readonly record: RouteRecord | null
  readonly matched: readonly RouteRecord[]
  readonly state?: unknown
}

export interface RouteComponentProps {
  readonly route: RouteLocation
  readonly params: RouteParams
  readonly query: RouteQuery
  readonly children?: VobsNode
}

export type RouteComponent = (props: RouteComponentProps) => VobsNode
export type RouteComponentModule = RouteComponent | { default: RouteComponent }
export type RouteComponentLoader = () => PromiseLike<RouteComponentModule>

export interface LazyRouteComponent {
  readonly kind: 'vobs-lazy-route'
  readonly load: RouteComponentLoader
}

export type RouteComponentDefinition = RouteComponent | LazyRouteComponent

export interface RouteLoaderContext {
  readonly route: RouteLocation
  readonly navigationId?: number
  readonly dataRequestId?: number
}

export type RouteLoader = (context: RouteLoaderContext) => unknown | PromiseLike<unknown>

export interface RouteRecord {
  readonly path?: string
  readonly component?: RouteComponentDefinition
  readonly source?: string
  readonly name?: string
  readonly meta?: Record<string, unknown>
  readonly loader?: RouteLoader
  readonly action?: RouteLoader
  readonly children?: readonly RouteRecord[]
}

export type RouteQueryInput = Record<string, unknown> | URLSearchParams

export interface RouteLocationRaw {
  readonly path?: string
  readonly name?: string
  readonly params?: Record<string, unknown>
  readonly query?: RouteQueryInput
  readonly hash?: string
  readonly state?: unknown
}

export type RouteTarget = string | RouteLocationRaw

export type NavigationGuardResult = void | boolean | RouteTarget
export type NavigationGuard = (
  to: RouteLocation,
  from: RouteLocation
) => NavigationGuardResult | PromiseLike<NavigationGuardResult>

export class NavigationCancelledError extends Error {
  readonly code = 'NAVIGATION_CANCELLED'

  constructor() {
    super('Vobs Router: navigation was cancelled by a newer navigation')
    this.name = 'NavigationCancelledError'
  }
}

export class NavigationRedirectError extends Error {
  readonly code = 'NAVIGATION_REDIRECT_LIMIT'

  constructor() {
    super('Vobs Router: navigation redirects exceeded the maximum count')
    this.name = 'NavigationRedirectError'
  }
}

export interface RouterHistory {
  readonly location: string
  /** Navigation state carried by the current history entry (written on push/replace, read back on popstate/initial start). */
  readonly state?: unknown
  push(path: string, state?: unknown): void
  replace(path: string, state?: unknown): void
  back(): void
  listen(listener: (path: string, state: unknown) => void): () => void
}

export interface RouterOptions {
  readonly routes: readonly RouteRecord[]
  readonly history?: RouterHistory
}

export interface RouterViewState {
  readonly status: 'ready' | 'loading' | 'error' | 'not-found'
  readonly component?: RouteComponent
  readonly layouts?: readonly RouteComponent[]
  readonly error?: Error
  readonly retry: () => void
}

export interface RouteDebugNode {
  readonly id: string
  readonly path: string
  readonly name?: string
  readonly component: string
  readonly lazy: boolean
  readonly loader: boolean
  readonly action: boolean
  readonly status: 'ready' | 'loading' | 'error'
  readonly meta: RouteMeta
  readonly source?: string
  readonly children: readonly RouteDebugNode[]
}

export interface RouteErrorTrace {
  readonly id: number
  readonly phase: 'navigation' | 'render' | 'lazy' | 'loader' | 'action' | 'fetcher'
  readonly route: string
  readonly message: string
  readonly stack?: string
  readonly timestamp: number
  readonly requestId?: number
  readonly navigationId?: number
}

export interface NavigationTrace {
  readonly id: number
  readonly from: string
  readonly to: string
  readonly status: 'success' | 'redirected' | 'cancelled' | 'error'
  readonly source: 'push' | 'replace' | 'history'
  readonly startedAt: number
  readonly endedAt: number
  readonly duration: number
  readonly redirect?: string
  readonly error?: string
}

export interface NavigationState {
  readonly status: 'idle' | 'loading' | 'error'
  readonly from: string
  readonly to: string
  readonly traceId?: number
  readonly error?: string
}

export interface RouterPerformanceMetrics {
  readonly navigationCount: number
  readonly averageNavigationDuration: number
  readonly slowNavigationCount: number
}

export type RouterDataRequestKind = 'loader' | 'action' | 'fetcher'

export interface RouterDataRequestTrace {
  readonly id: number
  readonly kind: RouterDataRequestKind
  readonly key: string
  readonly route?: string
  readonly status: 'loading' | 'success' | 'error' | 'cancelled'
  readonly startedAt: number
  readonly endedAt?: number
  readonly duration?: number
  readonly result?: unknown
  readonly error?: string
  readonly navigationId?: number
  readonly trigger?: 'navigation' | 'revalidate' | 'manual' | 'resource'
  readonly environment?: 'client' | 'server'
}

export interface RouterDataRequestOptions {
  readonly route?: string
  readonly navigationId?: number
  readonly trigger?: 'navigation' | 'revalidate' | 'manual' | 'resource'
  readonly environment?: 'client' | 'server'
}

export type RouterDevToolsEvent = 'navigation:start' | 'navigation:end' | 'route:update' | 'data-request' | 'error'

export interface RouterDevToolsAPI {
  getRouteTree(): readonly RouteDebugNode[]
  getCurrentRoute(): RouteLocation
  getNavigationState(): NavigationState
  getNavigationHistory(): readonly NavigationTrace[]
  getPerformanceMetrics(): RouterPerformanceMetrics
  getDataRequests(): readonly RouterDataRequestTrace[]
  getErrors(): readonly RouteErrorTrace[]
  trackDataRequest<T>(
    kind: RouterDataRequestKind,
    key: string,
    task: () => T | PromiseLike<T>,
    options?: RouterDataRequestOptions | string
  ): Promise<T>
  runAction<T>(key: string, task: () => T | PromiseLike<T>): Promise<T>
  runFetcher<T>(key: string, task: () => T | PromiseLike<T>): Promise<T>
  reportError(phase: RouteErrorTrace['phase'], error: unknown, route?: string, context?: { readonly requestId?: number; readonly navigationId?: number }): void
  revalidate(route?: string): Promise<void>
  subscribe(event: RouterDevToolsEvent, callback: (payload: unknown) => void): () => void
}

export interface Router {
  /**
   * **Read-only**. At runtime it is the internal writable signal (the framework itself writes it),
   * but only a read interface is exposed — the original type was `Signal<RouteLocation>`, and
   * `router.currentRoute.value = {...}` measurably rewrote the route to an arbitrary address
   * (address bar out of sync, guards not run, view not updated — silent inconsistency).
   *
   * Note: this only blocks type-level misuse (`.set(...)` and `value =` error in TS); it is **not**
   * a runtime freeze — a real freeze would require wrapping in a proxy, which changes object
   * identity (anyone comparing by reference would break). Weighing the options, the low-risk one
   * was chosen.
   */
  readonly currentRoute: ReadableSignal<RouteLocation>
  readonly history: RouterHistory
  resolve(to: RouteTarget): RouteLocation
  push(to: RouteTarget): Promise<RouteLocation | false>
  replace(to: RouteTarget): Promise<RouteLocation | false>
  back(): void
  beforeEach(guard: NavigationGuard): () => void
  getViewState(route: RouteLocation): RouterViewState
  readonly devtools: RouterDevToolsAPI
  destroy(): void
}

export interface RouterViewProps {
  readonly router?: Router
  /** Loading placeholder: JSX props are compiled by the compiler into lazy getters; a hand-written object literal may pass a node or a factory. */
  readonly loading?: VobsNode | (() => VobsNode | null | undefined)
  readonly notFound?: (route: RouteLocation) => VobsNode | null | undefined
  readonly error?: (error: Error, retry: () => void) => VobsNode | null | undefined
}

export interface RouterPluginOptions {
  readonly router?: Router
  readonly routes?: readonly RouteRecord[]
  readonly history?: RouterHistory
}

export const ROUTER_KEY: InjectionKey<Router> = createInjectionKey<Router>('vobs.router')

export function lazy(loader: RouteComponentLoader): LazyRouteComponent {
  return {
    kind: 'vobs-lazy-route',
    load: loader
  }
}

export function createMemoryHistory(initial = '/'): RouterHistory {
  let entries = [{ path: normalizeHistoryPath(initial), state: undefined as unknown }]
  let index = 0
  const listeners = new Set<(path: string, state: unknown) => void>()

  return {
    get location(): string {
      return entries[index]!.path
    },

    get state(): unknown {
      return entries[index]!.state
    },

    push(path: string, state?: unknown): void {
      const next = normalizeHistoryPath(path)
      entries = entries.slice(0, index + 1)
      entries.push({ path: next, state })
      index++
    },

    replace(path: string, state?: unknown): void {
      entries[index] = { path: normalizeHistoryPath(path), state }
    },

    back(): void {
      if (index === 0) return
      index--
      notifyListeners(listeners, entries[index]!.path, entries[index]!.state)
    },

    listen(listener: (path: string, state: unknown) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function createBrowserHistory(base = ''): RouterHistory {
  if (typeof window === 'undefined') {
    throw new Error('Vobs Router: createBrowserHistory requires a browser environment')
  }

  const normalizedBase = normalizeBase(base)
  const listeners = new Set<(path: string, state: unknown) => void>()
  const onPopState = (event: PopStateEvent): void => {
    notifyListeners(listeners, readBrowserLocation(normalizedBase), event.state)
  }

  return {
    get location(): string {
      return readBrowserLocation(normalizedBase)
    },

    get state(): unknown {
      return window.history.state
    },

    push(path: string, state?: unknown): void {
      window.history.pushState(state ?? null, '', withBase(normalizeHistoryPath(path), normalizedBase))
    },

    replace(path: string, state?: unknown): void {
      window.history.replaceState(state ?? null, '', withBase(normalizeHistoryPath(path), normalizedBase))
    },

    back(): void {
      window.history.back()
    },

    listen(listener: (path: string, state: unknown) => void): () => void {
      if (listeners.size === 0) window.addEventListener('popstate', onPopState)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) window.removeEventListener('popstate', onPopState)
      }
    }
  }
}

export function createHashHistory(): RouterHistory {
  if (typeof window === 'undefined') {
    throw new Error('Vobs Router: createHashHistory requires a browser environment')
  }

  const listeners = new Set<(path: string, state: unknown) => void>()
  // Hash mode: the route path hangs entirely after the URL's # (e.g. /users?tab=all → #/users?tab=all);
  // an empty hash counts as the root path. The server only serves index.html, so refreshes/direct
  // visits produce no extra requests.
  const readHashLocation = (): string =>
    normalizeHistoryPath(window.location.hash.replace(/^#/, '') || '/')
  // pushState/replaceState do not fire hashchange (aligned with browserHistory's popstate semantics);
  // manual URL edits, forward/back, and anchor clicks all fire hashchange, so a single listener covers
  // everything. State is read back via window.history.state (written by pushState, restored
  // automatically by the browser when traversing history).
  const onHashChange = (): void => {
    notifyListeners(listeners, readHashLocation(), window.history.state)
  }

  return {
    get location(): string {
      return readHashLocation()
    },

    get state(): unknown {
      return window.history.state
    },

    push(path: string, state?: unknown): void {
      window.history.pushState(state ?? null, '', `#${normalizeHistoryPath(path)}`)
    },

    replace(path: string, state?: unknown): void {
      window.history.replaceState(state ?? null, '', `#${normalizeHistoryPath(path)}`)
    },

    back(): void {
      window.history.back()
    },

    listen(listener: (path: string, state: unknown) => void): () => void {
      if (listeners.size === 0) window.addEventListener('hashchange', onHashChange)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) window.removeEventListener('hashchange', onHashChange)
      }
    }
  }
}

export function createRouter(options: RouterOptions): Router {
  const matchers = normalizeRoutes(options.routes)
  const history = options.history ?? defaultHistory()
  const routerDebugId = createRouterDebugId()
  matchers.sort(compareMatchers)
  // debug name: guards like C210/C211 reference it in their warnings; an unnamed signal only shows
  // "(unnamed signal)" in errors, which cannot be located
  const currentRoute = state<RouteLocation>(resolvePath(history.location), 'router.currentRoute')
  const lazyStates = new Map<RouteRecord, LazyState>()
  const guards: NavigationGuard[] = []
  const navigationHistory: NavigationTrace[] = []
  const dataRequests: RouterDataRequestTrace[] = []
  const errors: RouteErrorTrace[] = []
  const dataLoaders = new Map<string, { kind: RouterDataRequestKind; route: string; task: () => unknown | PromiseLike<unknown> }>()
  /**
   * Abort controller per navigation: when the navigation id advances (preempted, or destroy),
   * all earlier navigations are aborted immediately.
   *
   * Solves "`push` never settles when a guard/loader never resolves":
   * navigations used to hang indefinitely on `await guard(...)` — preemption only advanced the id
   * by one and never abandoned that await, so the promise hung forever (and navigationState stayed
   * stuck on loading with it).
   *
   * Aborting follows the existing contract: rejects with NavigationCancelledError, consistent with
   * guard cancellation/preemption.
   */
  const navigationAborts = new Map<number, () => void>()

  /** Advance the navigation id, and abort all earlier navigations. */
  function beginNavigation(): number {
    const id = ++navigationId
    for (const [olderId, abort] of [...navigationAborts]) {
      if (olderId < id) {
        navigationAborts.delete(olderId)
        abort()
      }
    }
    return id
  }
  const dataRequestContexts = new Map<number, RuntimeDebugContext>()
  const routerListeners = new Map<RouterDevToolsEvent, Set<(payload: unknown) => void>>()
  let navigationState: NavigationState = { status: 'idle', from: currentRoute.value.fullPath, to: currentRoute.value.fullPath }
  let navigationCount = 0
  let totalNavigationDuration = 0
  let slowNavigationCount = 0
  let nextDataRequestId = 1
  let nextErrorId = 1
  let navigationId = 0
  let destroyed = false
  const viewRevision = state(0, 'router.viewRevision')

  function resolve(to: RouteTarget): RouteLocation {
    ensureActive()
    const target = typeof to === 'string' ? parseTargetString(to) : normalizeTarget(to, matchers)
    return resolvePath(buildTargetPath(target.path, target.query, target.hash), target.state)
  }

  function resolvePath(rawPath: string, state?: unknown): RouteLocation {
    const parsed = parseTargetString(rawPath)
    const matched = matchers.find(matcher => matcher.regex.exec(parsed.path))
    const params = matched ? extractParams(matched, parsed.path) : {}
    const record = matched?.record ?? null
    const query = parsed.query
    const hash = parsed.hash
    return {
      path: parsed.path,
      fullPath: buildTargetPath(parsed.path, query, hash),
      params,
      query,
      hash,
      name: record?.name,
      meta: matched?.meta ?? {},
      record,
      matched: matched?.chain ?? EMPTY_MATCHED,
      state
    }
  }

/**
 * Attach an **internal** empty catch to the promise returned by the public navigation APIs.
 *
 * Why it is needed: a preempted navigation rejects with `NavigationCancelledError` (a contract
 * pinned in tests), and the most common call form is `void router.push(...)` (all over the
 * playground) — so every fast click flushed an unhandledRejection that only meant "this navigation
 * was superseded by a later one".
 *
 * Why not "change it to resolve(false)": that would change the public contract (tests explicitly
 * assert rejects) and is riskier. The empty catch only affects the "nobody attached" scenario: the
 * returned value is still a chain derived from the **same** promise, `await push()` still throws,
 * and caller behavior is completely unchanged.
 */
function guardUnhandled<T>(pending: Promise<T>): Promise<T> {
  pending.catch(() => { /* callers that do not care about being superseded must not be flagged unhandledRejection */ })
  return pending
}
  async function navigate(
    to: RouteTarget,
    replaceHistory: boolean,
    fromHistory: boolean,
    historyState?: unknown
  ): Promise<RouteLocation | false> {
    ensureActive()
    const from = currentRoute.value
    let target = resolve(to)
    // The state read back on popstate lives on the history entry, not in the target description; backfill it here.
    if (fromHistory && historyState !== undefined) target = { ...target, state: historyState }
    /*
     * Same address: return directly, **without ++navigationId**.
     *
     * This line used to sit after `++navigationId`, so `push(current address)` would advance the id
     * for nothing, killing the in-flight navigation as if it had been preempted
     * (`ensureNavigationIsCurrent` decides preemption by comparing ids).
     * It also no longer touches navigationState — that used to reset it to idle, which could
     * overwrite another in-flight navigation's loading.
     */
    if (target.fullPath === from.fullPath && !fromHistory) return from

    const id = beginNavigation()
    /*
     * Used to break the "currently awaiting a guard or loader" wait on preemption/destroy.
     * An empty catch is attached: it only rejects when aborted, and an abort always means a later
     * navigation is running — unattached, it would become an unhandledRejection (the same pit,
     * second occurrence, just fixed).
     */
    let abortNavigation: ((reason: unknown) => void) | undefined
    const aborted = new Promise<never>((_, reject) => { abortNavigation = reject })
    aborted.catch(() => {})
    navigationAborts.set(id, () => { abortNavigation?.(new NavigationCancelledError()) })
    const source: NavigationTrace['source'] = fromHistory ? 'history' : replaceHistory ? 'replace' : 'push'
    const startedAt = now()
    const initialTarget = target.fullPath
    let terminalRecorded = false
    navigationState = { status: 'loading', from: from.fullPath, to: target.fullPath, traceId: id }
    emitRouter('navigation:start', navigationState)

    try {
      for (let redirectCount = 0; ; redirectCount++) {
        ensureNavigationIsCurrent(id)
        let redirect: RouteTarget | undefined
        for (const guard of [...guards]) {
          let result: NavigationGuardResult
          try {
            result = await Promise.race([guard(target, from), aborted])
          } catch (reason) {
            if (reason instanceof NavigationCancelledError) throw reason
            const error = toError(reason)
            reportError('navigation', error, target.fullPath)
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'error', source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message })
            terminalRecorded = true
            throw reason
          }
          ensureNavigationIsCurrent(id)
          if (result === false) {
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'cancelled', source, startedAt, endedAt: now(), duration: now() - startedAt })
            terminalRecorded = true
            return false
          }
          if (typeof result === 'string' || isRouteLocationRaw(result)) {
            redirect = result
            break
          }
        }

        /*
         * The guard demands a redirect → **do not load this target's data yet**: it is about to be
         * abandoned, so loading would be wasted work.
         * The redirect handling used to sit after the loader loop; measured, both targets' loaders
         * all ran once.
         */        if (redirect !== undefined) {
          if (redirectCount >= 10) {
            const error = new NavigationRedirectError()
            recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'error', source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message })
            terminalRecorded = true
            throw error
          }
          const redirected = resolve(redirect)
          if (redirected.fullPath === target.fullPath) return false
          recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'redirected', source, startedAt, endedAt: now(), duration: now() - startedAt, redirect: redirected.fullPath })
          target = redirected
          continue
        }

        for (const record of target.matched) {
          if (!record.loader) continue
          // Cancel immediately when preempted by a new navigation during the previous loader, skipping the remaining loaders.
          ensureNavigationIsCurrent(id)
          /*
           * The loader itself has no signal and cannot be truly cancelled, but the navigation
           * **must not wait for it**: it settles immediately when preempted, and the late
           * completion is discarded by the ensureNavigationIsCurrent further down.
           */
          await Promise.race([
            trackDataRequest(
              'loader',
              `${target.fullPath}#${record.path ?? record.name ?? 'route'}`,
              context => record.loader!({ route: target, navigationId: id, dataRequestId: context.dataRequestId }),
              { route: target.fullPath, navigationId: id, trigger: 'navigation' }
            ),
            aborted
          ])
        }

        // Must re-validate after loaders complete and before committing: a navigation preempted
        // mid-flight must not overwrite currentRoute or history.
        ensureNavigationIsCurrent(id)



        if (target.fullPath === from.fullPath) return from
        if (!fromHistory) {
          if (replaceHistory) history.replace(target.fullPath, target.state)
          else history.push(target.fullPath, target.state)
        }
        currentRoute.value = target
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'success', source, startedAt, endedAt: now(), duration: now() - startedAt, redirect: target.fullPath !== initialTarget ? target.fullPath : undefined })
        terminalRecorded = true
        return target
      }
    } catch (reason) {
      if (reason instanceof NavigationCancelledError) {
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'cancelled', source, startedAt, endedAt: now(), duration: now() - startedAt })
        terminalRecorded = true
        /*
         * Keep `throw reason` here — preemption rejects with NavigationCancelledError, **a contract
         * pinned in tests** (index.test.ts:258 / :298 explicitly assert rejects); it cannot be
         * changed to return false.
         *
         * But "the public API's promise being flagged unhandledRejection when nobody attaches" was
         * a real problem: the playground is full of `void router.push(...)`. The fix is **not to
         * change the contract** but to attach an internal no-op catch at the public boundary (see
         * push/replace) — callers awaiting still get the rejection; callers not awaiting no longer
         * flood the console.
         */
      } else if (!terminalRecorded) {
        const error = toError(reason)
        reportError('navigation', error, target.fullPath)
        recordNavigation({ id, from: from.fullPath, to: target.fullPath, status: 'error', source, startedAt, endedAt: now(), duration: now() - startedAt, error: error.message })
        terminalRecorded = true
      }
      throw reason
    } finally {
      navigationAborts.delete(id)
    }
  }

  function now(): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now()
  }

  function emitRouter(event: RouterDevToolsEvent, payload: unknown): void {
    for (const callback of routerListeners.get(event) ?? []) {
      try { callback(payload) } catch { /* diagnostics must not affect navigation */ }
    }
    emitRouterDebug(routerDebugId, event, payload, getRuntimeDebugContext() ?? undefined)
  }

  function recordNavigation(trace: NavigationTrace): void {
    navigationHistory.push(Object.freeze(trace))
    if (navigationHistory.length > 100) navigationHistory.shift()
    navigationCount++
    totalNavigationDuration += trace.duration
    if (trace.duration >= 16) slowNavigationCount++
    if (trace.id === navigationId) {
      navigationState = trace.status === 'error'
        ? { status: 'error', from: trace.from, to: trace.to, traceId: trace.id, error: trace.error }
        : { status: 'idle', from: trace.from, to: trace.to, traceId: trace.id }
    }
    emitRouter('navigation:end', trace)
    emitRouter('route:update', currentRoute.value)
  }

  async function trackDataRequest<T>(
    kind: RouterDataRequestKind,
    key: string,
    task: ((context: { readonly dataRequestId: number }) => T | PromiseLike<T>) | (() => T | PromiseLike<T>),
    optionsOrRoute: RouterDataRequestOptions | string = {}
  ): Promise<T> {
    ensureActive()
    const options = typeof optionsOrRoute === 'string' ? { route: optionsOrRoute } : optionsOrRoute
    const id = nextDataRequestId++
    const startedAt = now()
    const context = getRuntimeDebugContext()
    const route = options.route ?? currentRoute.value.fullPath
    const requestContext: RuntimeDebugContext = {
      ...context,
      environment: options.environment ?? context?.environment,
      route,
      navigationId: options.navigationId ?? context?.navigationId,
      dataRequestId: id,
      source: kind
    }
    const loading: RouterDataRequestTrace = {
      id,
      kind,
      key,
      route,
      status: 'loading',
      startedAt,
      navigationId: requestContext.navigationId,
      trigger: options.trigger,
      environment: requestContext.environment
    }
    dataRequests.push(loading)
    if (dataRequests.length > 100) dataRequests.shift()
    dataRequestContexts.set(id, requestContext)
    emitRouter('route:update', currentRoute.value)
    emitRouter('data-request', loading)
    emitRouterDebug(routerDebugId, 'data-request', { phase: 'start', trace: loading }, requestContext)
    dataLoaders.set(key, { kind, route, task: task as () => unknown | PromiseLike<unknown> })
    try {
      const result = await runWithRuntimeDebugContext(requestContext, () => (task as (context: { readonly dataRequestId: number }) => T | PromiseLike<T>)({ dataRequestId: id }))
      const endedAt = now()
      replaceDataRequest(id, { ...loading, status: 'success', endedAt, duration: endedAt - startedAt, result })
      return result
    } catch (reason) {
      const endedAt = now()
      const error = toError(reason)
      const status = isAbortError(reason) ? 'cancelled' : 'error'
      if (status === 'error') reportError(kind, error, route, { requestId: id, navigationId: requestContext.navigationId })
      replaceDataRequest(id, { ...loading, status, endedAt, duration: endedAt - startedAt, error: status === 'error' ? error.message : undefined })
      throw reason
    }
  }

  function replaceDataRequest(id: number, trace: RouterDataRequestTrace): void {
    const index = dataRequests.findIndex(item => item.id === id)
    if (index >= 0) dataRequests[index] = Object.freeze(trace)
    emitRouter('route:update', currentRoute.value)
    emitRouter('data-request', trace)
    emitRouterDebug(routerDebugId, 'data-request', { phase: 'end', trace }, dataRequestContexts.get(id))
    dataRequestContexts.delete(id)
  }

  function reportError(
    phase: RouteErrorTrace['phase'],
    reason: unknown,
    route = currentRoute.value.fullPath,
    context: { readonly requestId?: number; readonly navigationId?: number } = {}
  ): void {
    const error = toError(reason)
    errors.push(Object.freeze({
      id: nextErrorId++,
      phase,
      route,
      message: error.message,
      stack: error.stack,
      timestamp: now(),
      requestId: context.requestId,
      navigationId: context.navigationId
    }))
    if (errors.length > 100) errors.shift()
    emitRouter('error', errors[errors.length - 1]!)
    emitRouter('route:update', currentRoute.value)
  }

  function routeTree(): readonly RouteDebugNode[] {
    const statuses = new Map<string, LazyState['status']>()
    for (const matcher of matchers) {
      for (const record of matcher.chain) {
        if (record.component && isLazyRouteComponent(record.component)) {
          const debugId = routeDebugIds.get(record)
          if (debugId) statuses.set(debugId, lazyStates.get(record)?.status ?? 'loading')
        }
      }
    }
    return buildRouteDebugTree(options.routes, statuses)
  }

  function handleHistoryNavigation(path: string, state: unknown): void {
    void navigate(path, false, true, state).then(result => {
      if (destroyed) return
      if (result === false) {
        history.replace(currentRoute.value.fullPath, currentRoute.value.state)
      } else if (result.fullPath !== normalizeHistoryPath(path)) {
        history.replace(result.fullPath, result.state)
      }
    }).catch(error => {
      if (!(error instanceof NavigationCancelledError) && !destroyed) {
        const current = currentRoute.value.fullPath
        const failed = toError(error)
        reportError('navigation', failed, normalizeHistoryPath(path))
        navigationState = { status: 'error', from: current, to: normalizeHistoryPath(path), error: failed.message }
        emitRouter('navigation:end', { status: 'error', from: current, to: normalizeHistoryPath(path), error: failed.message })
        history.replace(currentRoute.value.fullPath, currentRoute.value.state)
      }
    })
  }

  const stopHistory = history.listen(handleHistoryNavigation)

  const router: Router = {
    currentRoute,
    history,

    resolve,

    push(to: RouteTarget): Promise<RouteLocation | false> {
      return guardUnhandled(navigate(to, false, false))
    },

    replace(to: RouteTarget): Promise<RouteLocation | false> {
      return guardUnhandled(navigate(to, true, false))
    },

    back(): void {
      ensureActive()
      history.back()
    },

    beforeEach(guard: NavigationGuard): () => void {
      ensureActive()
      guards.push(guard)
      const off = (): void => {
        const index = guards.indexOf(guard)
        if (index >= 0) guards.splice(index, 1)
      }
      /*
       * Bind to the current Owner: guards registered inside a component are automatically removed
       * when the component unmounts.
       *
       * The original code only pushed into the guards array — so "guards kept running after their
       * component unmounted" (measured in the deep read): reading route state, issuing requests, and
       * performing auth redirects all happened in the name of a component that no longer existed.
       * The returned off() remains usable (repeated calls are idempotent).
       */
      getCurrentOwner()?.onDispose(off)
      return off
    },

    getViewState(route: RouteLocation): RouterViewState {
      viewRevision.value
      const records = route.matched.length > 0 ? route.matched : route.record ? [route.record] : []
      const entries = records
        .map(record => ({ record, definition: record.component }))
        .filter((entry): entry is { record: RouteRecord; definition: RouteComponentDefinition } =>
          isRouteComponentDefinition(entry.definition))
      if (!route.record || entries.length === 0) return { status: 'not-found', retry: () => undefined }

      const loaded: RouteComponent[] = []
      const lazyRecords: RouteRecord[] = []
      for (const entry of entries) {
        const { record, definition } = entry
        if (!isLazyRouteComponent(definition)) {
          loaded.push(definition)
          continue
        }
        lazyRecords.push(record)
        const lazyState = ensureLazyState(record, definition)
        if (lazyState.status === 'loading') return { status: 'loading', retry: () => retryLazyRoutes(lazyRecords) }
        if (lazyState.status === 'error') {
          return { status: 'error', error: lazyState.error, retry: () => retryLazyRoutes(lazyRecords) }
        }
        if (lazyState.component) loaded.push(lazyState.component)
      }

      const component = loaded[loaded.length - 1]
      if (!component) return { status: 'not-found', retry: () => undefined }
      return {
        status: 'ready',
        component,
        layouts: loaded.slice(0, -1),
        retry: () => retryLazyRoutes(lazyRecords)
      }
    },

    devtools: {
      getRouteTree: routeTree,
      getCurrentRoute: () => currentRoute.value,
      getNavigationState: () => navigationState,
      getNavigationHistory: () => [...navigationHistory],
      getPerformanceMetrics: () => ({
        navigationCount,
        averageNavigationDuration: navigationCount === 0 ? 0 : totalNavigationDuration / navigationCount,
        slowNavigationCount
      }),
      getDataRequests: () => [...dataRequests],
      getErrors: () => [...errors],
      trackDataRequest,
      runAction: (key, task) => trackDataRequest('action', key, task, { trigger: 'manual' }),
      runFetcher: (key, task) => trackDataRequest('fetcher', key, task, { trigger: 'manual' }),
      reportError,
      /*
       * No argument = **revalidate the current route's** data, not "replay every historical route's
       * loaders".
       *
       * Originally there was no route filter when `route === undefined`, so after visiting 5 routes,
       * calling `revalidate()` once fired a fresh round of requests for all 5 — most of them long
       * gone from the screen. Both the name and the typical usage ("refresh the current page after
       * data changed") point at the current route; passing a route explicitly behaves unchanged.
       *
       * Cost: the "replay everything" capability is no longer reachable. The only call site in the
       * repo is `router.devtools.revalidate()` in tests (with a single route); no real caller
       * depended on it.
       */
      revalidate: async (route) => {
        const target = route ?? currentRoute.value.fullPath
        await Promise.all([...dataLoaders.entries()]
          .filter(([, loader]) => loader.kind === 'loader' && loader.route === target)
          .map(([key, loader]) => trackDataRequest(loader.kind, key, loader.task, { route: loader.route, trigger: 'revalidate' })))
      },
      subscribe(event, callback) {
        let listeners = routerListeners.get(event)
        if (!listeners) { listeners = new Set(); routerListeners.set(event, listeners) }
        listeners.add(callback)
        return () => listeners?.delete(callback)
      }
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      // Use beginNavigation: destroy must also **abort** in-flight navigations (so they settle while
      // guards/loaders are pending) — it used to only do `navigationId++`, leaving that await hanging
      // forever and push never settling.
      beginNavigation()
      stopHistory()
      guards.length = 0
      routerListeners.clear()
      lazyStates.clear()
      errors.length = 0
      dataRequestContexts.clear()
      // dataLoaders holds each route's loader task closures — nobody uses them after destroy; keeping them only pins references.
      dataLoaders.clear()
      currentRoute.dispose()
      viewRevision.dispose()
    }
  }

  function ensureLazyState(record: RouteRecord, definition: LazyRouteComponent): LazyState {
    let lazyState = lazyStates.get(record)
    if (!lazyState) {
      lazyState = { status: 'loading' }
      lazyStates.set(record, lazyState)
      void loadRouteComponent(definition).then(component => {
        if (destroyed) return
        lazyState!.status = 'ready'
        lazyState!.component = component
        viewRevision.value++
        emitRouter('route:update', currentRoute.value)
      }).catch(reason => {
        if (destroyed) return
        lazyState!.status = 'error'
        lazyState!.error = toError(reason)
        reportError('lazy', reason, currentRoute.value.fullPath)
        viewRevision.value++
        emitRouter('route:update', currentRoute.value)
      })
    }
    return lazyState
  }

  function retryLazyRoutes(records: readonly RouteRecord[]): void {
    for (const record of records) lazyStates.delete(record)
    viewRevision.value++
  }

  function ensureActive(): void {
    if (destroyed) throw new Error('Vobs Router: a destroyed Router cannot be used any further')
  }

  function ensureNavigationIsCurrent(id: number): void {
    if (id !== navigationId) throw new NavigationCancelledError()
  }

  return router
}

export function RouterView(props: RouterViewProps = {}): VobsNode {
  const router = props.router ?? inject(ROUTER_KEY)
  if (!router) throw new Error('Vobs Router: RouterView could not find a Router, install routerPlugin')

  return createFragment((parent, anchor) => {
    let routeRetry: () => void = () => undefined
    insertBoundary(parent, anchor, {
      /*
       * The whole tree resets by fullPath — **this is load-bearing, do not "tidy" it away**.
       *
       * Component bodies execute once (run-once); route state read inside the body
       * (`router.currentRoute.value.path`, `query.*`) would otherwise freeze at the first render's
       * values. Remounting the view subtree on every fullPath change is exactly what makes those
       * reads re-evaluate. The playground's C118 case (`const activeKey = route.value.path…`)
       * staying correct at runtime relies on this.
       *
       * Cost: query-only changes (pagination/filters, `?page=1 → 2`) also remount the page
       * component, losing in-component state, scroll position, and uncommitted drafts.
       *
       * Why not key by path or matched record instead: that would let "body reads query" code go
       * silently stale (an inconsistent model where path reads refresh but query reads do not) —
       * worse than today. A real fix requires adding a **selector/memo helper for route-derived
       * values** (the router currently has no such helper) so apps need not rely on remounting —
       * that is a feature-level change, not something to slip in here.
       */
      resetKey: () => router.currentRoute.value.fullPath,
      onRetry: () => routeRetry(),
      fallback: (error, retry) => {
        router.devtools.reportError('render', error, router.currentRoute.value.fullPath)
        // When an error fallback is provided, its return value is fully respected (including explicit null);
        // without one, render the built-in error UI (with retry) instead of silently rendering a blank page —
        // a child effect throwing (e.g. inner bare reads of a nullable signal inside conditional children)
        // used to swap the whole page for blankness
        if (props.error !== undefined) return props.error(error, () => { void retry() })
        return createRouteErrorFallback(error, () => { void retry() })
      },
      children: () => {
      const route = router.currentRoute.value
      const view = router.getViewState(route)
      routeRetry = view.retry
      if (view.status === 'loading') {
        return (typeof props.loading === 'function' ? props.loading() : props.loading) ?? null
      }
      if (view.status === 'not-found') return props.notFound?.(route) ?? null
      if (view.status === 'error') {
        throw view.error ?? new Error('route component failed to load')
      }
      if (!view.component) return null
      let node = createComponent(view.component, {
        route,
        params: route.params,
        query: route.query
      })
      for (let index = (view.layouts?.length ?? 0) - 1; index >= 0; index--) {
        node = createComponent(view.layouts![index]!, {
          route,
          params: route.params,
          query: route.query,
          children: node
        })
      }
      return node
    }})
  })
}

export function useRouter(): Router {
  const router = inject(ROUTER_KEY)
  if (!router) throw new Error('Vobs Router: useRouter could not find a Router, install routerPlugin')
  return router
}

/** Default fallback UI for route errors: the .vobs-route-error class lets apps override styles; retry re-renders the current route */
function createRouteErrorFallback(error: Error, retry: () => void): VobsNode {
  // Everything goes through renderer-neutral APIs: during SSR prerendering, route component render
  // errors trigger this fallback too, and direct DOM manipulation (style/append/addEventListener)
  // would crash in Node and mask the original error.
  const box = createElement('div')
  setAttribute(box, 'class', 'vobs-route-error')
  setAttribute(box, 'style', 'padding:48px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;font-family:system-ui, -apple-system, sans-serif;color:#5a5f6a')

  const title = createElement('div')
  setAttribute(title, 'style', 'font-size:16px;font-weight:600;color:#1c1c1e')
  insertBefore(title, createText('Page failed to render'), null)

  const message = createElement('code')
  setAttribute(message, 'style', 'font-size:12px;max-width:520px;word-break:break-word;opacity:0.75')
  insertBefore(message, createText(error.message), null)

  const button = createElement('button')
  setAttribute(button, 'type', 'button')
  setAttribute(button, 'style', 'padding:6px 20px;font-size:13px;cursor:pointer')
  insertBefore(button, createText('Retry'), null)
  addEventListener(button, 'click', retry)

  insertBefore(box, title, null)
  insertBefore(box, message, null)
  insertBefore(box, button, null)
  return box
}

export function useRoute(): ReadableSignal<RouteLocation> {
  return useRouter().currentRoute
}

/* ---------------- Launch flags (2026-10-28, the standard part for Finora's "URL switch params" pit) ---------------- */

/**
 * Launch flags captured once at module load time.
 *
 * The correct way to read **app-level switches** like `?cloud` / `?shell=cockpit`: capture once at
 * module load and never re-read during SPA navigation — route changes rewrite the URL, and re-reading
 * `location.search` at runtime makes the flags drift back off (empirically hit). Both history form
 * (`/?cloud`) and hash form (`/#/path?cloud`) are recognized.
 */
const launchFlags: ReadonlySet<string> = ((): ReadonlySet<string> => {
  if (typeof window === 'undefined') return new Set<string>()
  const flags = new Set<string>()
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : ''
  for (const source of [window.location.search, hashQuery]) {
    for (const key of new URLSearchParams(source).keys()) flags.add(key)
  }
  return flags
})()

/** Whether a launch flag is present (constant for the app's lifetime; see launchFlags' capture semantics). */
export function hasLaunchFlag(name: string): boolean {
  return launchFlags.has(name)
}

/** Reads a launch flag's value; returns null when the flag is absent (boolean flags use hasLaunchFlag). */
export function readLaunchQuery(name: string): string | null {
  if (typeof window === 'undefined') return null
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : ''
  for (const source of [hashQuery, window.location.search]) {
    const value = new URLSearchParams(source).get(name)
    if (value !== null) return value
  }
  return null
}

export function routerPlugin(options: RouterPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/router',
    version: '0.1.0',
    install(context) {
      const ownedRouter = options.router ? undefined : createRouter({
        routes: options.routes ?? [],
        history: options.history
      })
      const router = options.router ?? ownedRouter!
      context.provide(ROUTER_KEY, router)
      return () => ownedRouter?.destroy()
    }
  }
}

interface RouteMatcher {
  readonly record: RouteRecord
  readonly debugId: string
  readonly chain: readonly RouteRecord[]
  readonly meta: RouteMeta
  readonly regex: RegExp
  readonly keys: readonly string[]
  readonly score: number
  readonly order: number
}

interface LazyState {
  status: 'loading' | 'ready' | 'error'
  component?: RouteComponent
  error?: Error
}

interface ParsedTarget {
  readonly path: string
  readonly query: RouteQuery
  readonly hash: string
  readonly state?: unknown
}

function defaultHistory(): RouterHistory {
  return typeof window === 'undefined' ? createMemoryHistory('/') : createBrowserHistory()
}

const EMPTY_MATCHED: readonly RouteRecord[] = Object.freeze([])
const routeDebugIds = new WeakMap<RouteRecord, string>()

function buildRouteDebugTree(routes: readonly RouteRecord[], lazyStatuses: ReadonlyMap<string, LazyState['status']> = new Map()): readonly RouteDebugNode[] {
  const visit = (records: readonly RouteRecord[], parentPath: string, parentId: string): RouteDebugNode[] => records.map((record, index) => {
    const path = record.path === undefined ? parentPath || '/' : resolveChildPath(parentPath, record.path)
    const id = `${parentId}.${index}`
    const definition = record.component
    const lazyDefinition = definition !== undefined && isLazyRouteComponent(definition)
    const componentName = definition === undefined
      ? 'Route'
      : lazyDefinition
        ? 'lazy(...)'
        : typeof definition === 'function'
          ? definition.name || 'Anonymous'
          : 'Route'
    return {
      id,
      path,
      name: record.name,
      component: componentName,
      source: record.source,
      lazy: lazyDefinition,
      loader: record.loader !== undefined,
      action: record.action !== undefined,
      status: lazyDefinition ? (lazyStatuses.get(id) ?? 'loading') : 'ready',
      meta: Object.freeze({ ...(record.meta ?? {}) }),
      children: visit(record.children ?? [], path, id)
    }
  })
  return Object.freeze(visit(routes, '', 'route'))
}

function normalizeRoutes(routes: readonly RouteRecord[]): RouteMatcher[] {
  const matchers: RouteMatcher[] = []
  let order = 0

  function visit(records: readonly RouteRecord[], parentPath: string, parentChain: readonly RouteRecord[], parentMeta: RouteMeta, parentId = 'route'): void {
    records.forEach((record, index) => {
      const debugId = `${parentId}.${index}`
      const children = record.children ?? []
      const path = record.path === undefined
        ? parentPath
        : resolveChildPath(parentPath, record.path)
      const normalized: RouteRecord = {
        ...record,
        path: record.path === undefined
          ? (children.length > 0 ? undefined : (path || '/'))
          : path,
        meta: record.meta ? { ...record.meta } : {}
      }
      routeDebugIds.set(normalized, debugId)
      const chain = [...parentChain, normalized]
      const meta = Object.freeze({ ...parentMeta, ...(normalized.meta ?? {}) })
      if (children.length > 0) {
        visit(children, path, chain, meta, debugId)
      } else if (normalized.component) {
        matchers.push(createMatcher(normalized, chain, meta, order++, debugId))
      } else if (normalized.path === undefined) {
        throw new Error(`Vobs Router: route ${index + 1} is missing path or children`)
      }
    })
  }

  visit(routes, '', [], {})
  return matchers
}

function resolveChildPath(parentPath: string, childPath: string): string {
  const normalizedChild = normalizePath(childPath)
  if (!parentPath || normalizedChild === '/') return normalizedChild === '/' ? (parentPath || '/') : normalizedChild
  if (childPath.startsWith('/')) return normalizedChild
  return normalizePath(`${parentPath}/${childPath}`)
}

function createMatcher(record: RouteRecord, chain: readonly RouteRecord[], meta: RouteMeta, order: number, debugId: string): RouteMatcher {
  const path = record.path ?? '/'
  const segments = path === '/' ? [] : path.slice(1).split('/')
  const keys: string[] = []
  let score = 0
  const pattern = segments.map(segment => {
    if (segment === '*') {
      keys.push('pathMatch')
      return '(.*)'
    }
    if (segment.startsWith(':')) {
      const key = segment.slice(1)
      if (!key) throw new Error(`Vobs Router: route ${path} has an empty parameter name`)
      if (keys.includes(key)) throw new Error(`Vobs Router: route ${path} has a duplicate parameter ${key}`)
      keys.push(key)
      score += 1
      return '([^/]+)'
    }
    score += 3
    return escapeRegExp(segment)
  }).join('/')

  return {
    record,
    debugId,
    chain: Object.freeze([...chain]),
    meta,
    regex: new RegExp(segments.length === 0 ? '^/?$' : `^/${pattern}/?$`),
    keys,
    score,
    order
  }
}

function compareMatchers(left: RouteMatcher, right: RouteMatcher): number {
  return right.score - left.score || left.order - right.order
}

function extractParams(matcher: RouteMatcher, path: string): RouteParams {
  const match = matcher.regex.exec(path)
  if (!match) return {}
  const params: Record<string, string> = {}
  matcher.keys.forEach((key, index) => {
    params[key] = decodeRoutePart(match[index + 1] ?? '')
  })
  return Object.freeze(params)
}

function parseTargetString(raw: string): ParsedTarget {
  const hashIndex = raw.indexOf('#')
  const hash = hashIndex >= 0 ? normalizeHash(raw.slice(hashIndex + 1)) : ''
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  const queryIndex = withoutHash.indexOf('?')
  const path = normalizePath(queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash)
  const query = queryIndex >= 0 ? parseQuery(withoutHash.slice(queryIndex + 1)) : {}
  return { path, query, hash }
}

function normalizeTarget(target: RouteLocationRaw, matchers: readonly RouteMatcher[]): ParsedTarget {
  let path = target.path
  if (!path && target.name) {
    const matcher = matchers.find(candidate => candidate.record.name === target.name)
    if (!matcher) throw new Error(`Vobs Router: no route named ${target.name} found`)
    path = fillRouteParams(matcher.record.path ?? '/', target.params ?? {})
  }
  if (!path) throw new Error('Vobs Router: navigation target must provide a path or a name')

  const parsed = parseTargetString(path)
  const filledPath = fillRouteParams(parsed.path, target.params ?? {})
  const query = target.query === undefined ? parsed.query : normalizeQuery(target.query)
  const hash = target.hash === undefined ? parsed.hash : normalizeHash(target.hash)
  return { path: filledPath, query, hash, state: target.state }
}

function fillRouteParams(path: string, params: Record<string, unknown>): string {
  return path.replace(/:([A-Za-z0-9_]+)|\*/g, (token, key: string | undefined) => {
    const value = key ? params[key] : params.pathMatch
    /*
     * Missing params **must not silently degrade any more**.
     *
     * This used to `return token` — so `push({ name: 'user' })` would "successfully" land on
     * `/users/:id`: the address bar showed the literal `:id` and `params.id` was the string ':id'.
     * No error, wrong result; the page even rendered, just with wrong data — this class of silent
     * error is far harder to diagnose than a direct throw.
     */
    if (value === undefined || value === null) {
      const name = key ? `"${key}"` : '"pathMatch" (wildcard segment)'
      throw new Error(`Vobs Router: target path "${path}" requires the parameter ${name} but none was provided — `
        + `continuing would produce the literal address "${token}". Supply it in push/replace, or use a different route.`)
    }
    return encodeURIComponent(String(value))
  })
}

function buildTargetPath(path: string, query: RouteQuery, hash: string): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    if (typeof value === 'string') {
      params.set(key, value)
    } else {
      for (const item of value) params.append(key, item)
    }
  }
  const serialized = params.toString()
  return `${path}${serialized ? `?${serialized}` : ''}${hash}`
}

function parseQuery(raw: string): RouteQuery {
  const params = new URLSearchParams(raw)
  const result: Record<string, RouteQueryValue> = {}
  params.forEach((value, key) => {
    const previous = result[key]
    if (previous === undefined) result[key] = value
    else if (typeof previous === 'string') result[key] = [previous, value]
    else result[key] = [...previous, value]
  })
  for (const key of Object.keys(result)) {
    if (Array.isArray(result[key])) result[key] = Object.freeze(result[key] as string[])
  }
  return Object.freeze(result)
}

function normalizeQuery(input: RouteQueryInput): RouteQuery {
  if (input instanceof URLSearchParams) return parseQuery(input.toString())
  const result: Record<string, RouteQueryValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) result[key] = Object.freeze(value.map(item => String(item)))
    else result[key] = String(value)
  }
  return Object.freeze(result)
}

function normalizePath(path: string): string {
  if (!path) return '/'
  const withoutQuery = path.split(/[?#]/, 1)[0] || '/'
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  if (withLeadingSlash === '/*' || withLeadingSlash === '/') return withLeadingSlash
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function normalizeHistoryPath(path: string): string {
  const parsed = parseTargetString(path)
  return buildTargetPath(parsed.path, parsed.query, parsed.hash)
}

function normalizeHash(hash: string): string {
  if (!hash) return ''
  return hash.startsWith('#') ? hash : `#${hash}`
}

function normalizeBase(base: string): string {
  if (!base || base === '/') return ''
  return `/${base.replace(/^\/+|\/+$/g, '')}`
}

function readBrowserLocation(base: string): string {
  const pathname = window.location.pathname
  const path = base && (pathname === base || pathname.startsWith(`${base}/`))
    ? pathname.slice(base.length) || '/'
    : pathname
  return normalizeHistoryPath(`${path}${window.location.search}${window.location.hash}`)
}

function withBase(path: string, base: string): string {
  return `${base}${path === '/' ? '/' : path}` || '/'
}

function notifyListeners(listeners: Set<(path: string, state: unknown) => void>, path: string, state: unknown): void {
  for (const listener of [...listeners]) listener(path, state)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeRoutePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isLazyRouteComponent(value: RouteComponentDefinition): value is LazyRouteComponent {
  return typeof value === 'object' && value !== null && value.kind === 'vobs-lazy-route'
}

function isRouteComponentDefinition(value: unknown): value is RouteComponentDefinition {
  return typeof value === 'function' || isLazyRouteComponent(value as RouteComponentDefinition)
}

async function loadRouteComponent(loader: LazyRouteComponent): Promise<RouteComponent> {
  const module = await loader.load()
  const component = typeof module === 'function' ? module : module.default
  if (typeof component !== 'function') throw new Error('Vobs Router: lazy module has no default component export')
  return component
}

function isRouteLocationRaw(value: unknown): value is RouteLocationRaw {
  return Boolean(value) && typeof value === 'object'
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

function isAbortError(reason: unknown): boolean {
  return Boolean(reason) && typeof reason === 'object'
    && ((reason as { readonly name?: unknown }).name === 'AbortError'
      || (reason as { readonly code?: unknown }).code === 'ERR_CANCELED')
}
