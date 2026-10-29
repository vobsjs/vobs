// Client entry: hydrates the prerendered HTML + syncs <head> on route navigation.
// Shares site.tsx with entry-server (same route table / same head) — a prerequisite for strict hydration matching.
import { createBrowserHistory, createRouter, RouterView } from '@vobs/router'
import { createHeadSync, hydrate, type SSRState } from '@vobs/ssr'
import { routes, headMap } from './site'

declare global {
  interface Window {
    __VOBS_STATE__?: SSRState
  }
}

const router = createRouter({
  history: createBrowserHistory(),
  routes
})
createHeadSync(router, path => headMap[path] ?? [])

hydrate(() => RouterView({ router }), '#app', { state: window.__VOBS_STATE__ })
