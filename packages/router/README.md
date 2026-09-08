# @vobs/router

Signals-first client router for Vobs with guards, route loaders, and cancellation of superseded navigations.

## Install

```bash
npm install @vobs/router
```

## Quick start

```ts
import { createVobs, createText } from '@vobs/vobs'
import { createRouter, createMemoryHistory, RouterView, routerPlugin } from '@vobs/router'

const router = createRouter({
  history: createMemoryHistory('/'),
  routes: [
    { path: '/', name: 'home', component: () => createText('home') },
    { path: '/users/:id', name: 'user', component: () => createText('user') }
  ]
})

// Guards return undefined (allow), false (cancel), or a redirect target.
router.beforeEach(to => (to.path.startsWith('/admin') ? '/login' : undefined))

const app = createVobs({
  render: () => RouterView({ loading: () => createText('loading'), notFound: () => createText('not-found') }),
  plugins: [routerPlugin({ router })]
})

await router.push({ name: 'user', params: { id: '7' }, query: { tab: 'activity' } })
router.currentRoute.value.fullPath // '/users/7?tab=activity'
```

## API

| Signature | Description |
| --- | --- |
| `createRouter(options: RouterOptions): Router` | Creates a router; defaults to browser history in the DOM and memory history otherwise. |
| `router.currentRoute: Signal<RouteLocation>` | Reactive current route with `path`, `params`, `query`, `hash`, `meta`, and `matched` records. |
| `router.push(to: RouteTarget)` | Navigates and resolves to the new `RouteLocation`, or `false` when a guard cancels. |
| `router.replace(to: RouteTarget)` | Like `push` but replaces the history entry. |
| `router.resolve(to: RouteTarget): RouteLocation` | Resolves a target to a location without navigating. |
| `router.back(): void` | Goes back in history. |
| `router.beforeEach(guard: NavigationGuard): () => void` | Registers a global guard and returns its unregister function. |
| `router.getViewState(route: RouteLocation): RouterViewState` | Resolves `ready`, `loading`, `error`, or `not-found` for the matched components. |
| `router.devtools: RouterDevToolsAPI` | Navigation traces, data-request tracking, errors, metrics, and revalidation. |
| `router.destroy(): void` | Stops history listening and disposes internal signals. |
| `routerPlugin(options?: RouterPluginOptions): VobsPlugin` | Provides the router through `ROUTER_KEY`. |
| `RouterView(props?: RouterViewProps): VobsNode` | Renders the matched component with nested layouts plus `loading`, `notFound`, and `error` slots. |
| `useRouter(): Router` | Injects the router inside components. |
| `useRoute(): Signal<RouteLocation>` | Injects the current-route signal. |
| `lazy(loader: RouteComponentLoader): LazyRouteComponent` | Wraps a dynamic import as a lazy route component. |
| `createMemoryHistory(initial?): RouterHistory` | In-memory history for tests and SSR. |
| `createBrowserHistory(base?): RouterHistory` | History API adapter with `popstate` support. |

Guards and route `loader`s run before a navigation commits. A newer navigation cancels the pending one: its promise rejects with `NavigationCancelledError`, and a late loader result cannot overwrite the current route or history. Guard redirects are capped at 10 hops (`NavigationRedirectError`).

## Types

`RouteLocation`, `RouteRecord`, `RouteComponent`, `RouteComponentProps`, `RouteComponentModule`, `RouteComponentLoader`, `RouteComponentDefinition`, `LazyRouteComponent`, `RouteLoader`, `RouteLoaderContext`, `NavigationGuard`, `NavigationGuardResult`, `RouteTarget`, `RouteLocationRaw`, `RouteQueryInput`, `RouteParams`, `RouteQuery`, `RouteQueryValue`, `RouteMeta`, `RouterOptions`, `RouterHistory`, `RouterViewState`, `Router`, `RouterViewProps`, `RouterPluginOptions`, `NavigationState`, `NavigationTrace`, `RouteErrorTrace`, `NavigationCancelledError`, `NavigationRedirectError`, `RouterPerformanceMetrics`, `RouterDevToolsAPI`, `RouterDevToolsEvent`, `RouterDataRequestKind`, `RouterDataRequestTrace`, `RouterDataRequestOptions`, `RouteDebugNode`, `RouterDebugEvent`, `RouterDebugEventType`
