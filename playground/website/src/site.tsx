// 官网 demo 共享模块：页面组件 + 路由表 + 每页 head 配置。
// entry-server（构建时预渲染）与 entry-client（水合）共用，保证两侧渲染结果一致（水合严格匹配的前提）。
import { state } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import type { RouteRecord } from '@vobs/router'
import type { HeadTag } from '@vobs/ssr'

/** 首页：证明 SSR 内容直出（爬虫可见）+ 水合后事件可交互 */
export function HomePage(): VobsNode {
  const clicks = state(0)
  return (
    <main class="page">
      <h1>Vobs 官网 Demo</h1>
      <p>本页由 SSG 构建时预渲染：爬虫直接看到完整 HTML，浏览器加载后水合接管。</p>
      <button type="button" onClick={() => clicks.set(clicks.value + 1)}>
        水合后点我 {clicks.value} 次
      </button>
      <p><a href="/features">前往功能页</a>（SSG 页面间用原生链接整页跳转）</p>
    </main>
  )
}

/** 功能页：纯静态内容，验证第二页预渲染直出 */
export function FeaturesPage(): VobsNode {
  return (
    <main class="page">
      <h1>功能</h1>
      <ul>
        <li>Signals First · 零重渲染</li>
        <li>SSG 预渲染 · SEO 完整</li>
        <li>精确水合 · mismatch 即报错</li>
      </ul>
      <p><a href="/">返回首页</a></p>
    </main>
  )
}

export const routes: readonly RouteRecord[] = [
  { path: '/', component: HomePage },
  { path: '/features', component: FeaturesPage }
]

/** 每页 SEO 标签（服务端 <head> 注入 + 客户端 createHeadSync 导航同步共用） */
export const headMap: Readonly<Record<string, readonly HeadTag[]>> = {
  '/': [
    { tag: 'title', text: 'Vobs 官网 Demo · 首页' },
    { tag: 'meta', attrs: { name: 'description', content: 'Vobs 框架 SSG 预渲染演示首页' } },
    { tag: 'meta', attrs: { property: 'og:title', content: 'Vobs 官网 Demo' } }
  ],
  '/features': [
    { tag: 'title', text: '功能 · Vobs 官网 Demo' },
    { tag: 'meta', attrs: { name: 'description', content: 'Vobs 框架核心功能一览' } }
  ]
}
