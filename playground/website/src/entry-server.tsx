// Server entry: compiled by vite build --ssr, then imported by scripts/prerender.mjs to run prerendering.
// Page components and route table come from site.tsx (shared with entry-client, guaranteeing strict hydration matching).
import { prerenderRoutes } from '@vobs/ssr'
import { routes, headMap } from './site'

export async function prerender() {
  return prerenderRoutes({
    routes: Object.keys(headMap),
    routeRecords: routes,
    head: path => headMap[path] ?? []
  })
}
