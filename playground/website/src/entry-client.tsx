// 客户端入口：水合预渲染 HTML + 路由导航时同步 <head>。
// 与 entry-server 共用 site.tsx（同路由表/同 head），是水合严格匹配的前提。
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
