// Website demo shared module: page components + route table + per-page head config.
// Shared by entry-server (build-time prerender) and entry-client (hydration), guaranteeing identical
// render output on both sides (a prerequisite for strict hydration matching).
import { state } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import type { RouteRecord } from '@vobs/router'
import type { HeadTag } from '@vobs/ssr'

/** Home page: proves SSR content is served directly (crawler-visible) + events are interactive after hydration */
export function HomePage(): VobsNode {
  const clicks = state(0, 'clicks')
  return (
    <main class="page">
      <h1>Vobs Website Demo</h1>
      <p>This page was prerendered by SSG at build time: crawlers see the complete HTML directly, and hydration takes over once the browser loads it.</p>
      <button type="button" onClick={() => clicks.set(clicks.value + 1)}>
        Clicks after hydration: {clicks.value}
      </button>
      <p><a href="/features">Go to the Features page</a> (SSG pages navigate via native full-page links)</p>
    </main>
  )
}

/** Features page: purely static content, verifying that a second page prerenders directly */
export function FeaturesPage(): VobsNode {
  return (
    <main class="page">
      <h1>Features</h1>
      <ul>
        <li>Signals First · Zero Re-renders</li>
        <li>SSG Prerendering · Full SEO</li>
        <li>Precise Hydration · Mismatch Fails Fast</li>
      </ul>
      <p><a href="/">Back to home</a></p>
    </main>
  )
}

export const routes: readonly RouteRecord[] = [
  { path: '/', component: HomePage },
  { path: '/features', component: FeaturesPage }
]

/** Per-page SEO tags (shared by server <head> injection and client-side createHeadSync navigation sync) */
export const headMap: Readonly<Record<string, readonly HeadTag[]>> = {
  '/': [
    { tag: 'title', text: 'Vobs Website Demo · Home' },
    { tag: 'meta', attrs: { name: 'description', content: 'Home page of the Vobs framework SSG prerender demo' } },
    { tag: 'meta', attrs: { property: 'og:title', content: 'Vobs Website Demo' } }
  ],
  '/features': [
    { tag: 'title', text: 'Features · Vobs Website Demo' },
    { tag: 'meta', attrs: { name: 'description', content: 'An overview of the core Vobs framework features' } }
  ]
}
