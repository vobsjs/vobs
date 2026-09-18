// 服务端入口：vite build --ssr 编译后由 scripts/prerender.mjs import 执行预渲染。
// 页面组件与路由表来自 site.tsx（与 entry-client 共用，保证水合严格匹配）。
import { prerenderRoutes } from '@vobs/ssr'
import { routes, headMap } from './site'

export async function prerender() {
  return prerenderRoutes({
    routes: Object.keys(headMap),
    routeRecords: routes,
    head: path => headMap[path] ?? []
  })
}
