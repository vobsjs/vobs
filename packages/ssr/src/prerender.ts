// SSG 预渲染：构建时把每条路由渲染成完整 HTML（积木层，不碰文件系统——
// 落盘由调用方脚本负责，保持本包同构纯净）。
// 设计：每个目标路径用「占位启动路径」创建 Router，push 真实路径以完整执行
// guards/loader（同路径 push 会被 router 去重跳过，loader 不会跑）。
import {
  createMemoryHistory,
  createRouter,
  RouterView,
  type RouteRecord,
  type Router
} from '@vobs/router'
import type { VobsNode, VobsPlugin } from '@vobs/vobs'
import { escapeAttribute, escapeHTML } from './renderer'
import { renderToStringAsync, serializeState, type SSRDebugSnapshot, type SSRState, type SSRStateOptions } from './render'

/* ---------- Head 管理 ---------- */

/** SEO 标签：title 用 text；meta/link 用 attrs（name/property/content 等） */
export type HeadTag =
  | { readonly tag: 'title'; readonly text: string }
  | { readonly tag: 'meta'; readonly attrs: Readonly<Record<string, string>> }
  | { readonly tag: 'link'; readonly attrs: Readonly<Record<string, string>> }

/** 序列化 head 标签为字符串（服务端 <head> 注入用；文本与属性均转义） */
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
    html += ` ${key}="${escapeAttribute(String(value))}"`
  }
  return html
}

/** 客户端：把 head 标签应用到 document（title 直接替换；meta/link 按「识别键」复用已有元素） */
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

/** 识别键：决定 meta/link 是否为同一个逻辑标签（meta 按 name/property 等，link 按 rel） */
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

/** 客户端：路由切换时同步 head（SSG 水合后的 SPA 导航；返回注销函数） */
export function createHeadSync(
  router: Router,
  headFor: (path: string) => readonly HeadTag[]
): () => void {
  return router.beforeEach(to => {
    applyHead(headFor(to.path))
  })
}

/* ---------- 预渲染 ---------- */

export interface PrerenderPage {
  /** 请求路径（options.routes 中的原始值） */
  readonly path: string
  /** 导航完成后的真实路由 fullPath（守卫重定向后可能与 path 不同） */
  readonly fullPath: string
  /** <div id="app"> 内的渲染结果（不含外壳） */
  readonly html: string
  /** 序列化后的 <head> 标签串 */
  readonly head: string
  /** 脱水状态（传给 renderPage 注入 __VOBS_STATE__） */
  readonly state?: SSRState
}

export interface PrerenderTemplateParts {
  readonly head: string
  readonly body: string
  readonly state: string
}

export interface PrerenderOptions extends SSRStateOptions {
  /** 预渲染的路由清单，如 ['/', '/pricing', '/download'] */
  readonly routes: readonly string[]
  /** 官网路由表（同 createRouter 的 routes） */
  readonly routeRecords: readonly RouteRecord[]
  /** 整站根组件；默认 () => RouterView({ router }) */
  readonly render?: (router: Router) => VobsNode
  /** 每页 SEO 标签 */
  readonly head?: (path: string) => readonly HeadTag[]
  /** 额外插件（i18n/theme 等） */
  readonly plugins?: VobsPlugin[]
  /** 请求诊断 side-channel */
  readonly debug?: { readonly captureRequests?: boolean }
}

export interface PrerenderResult {
  readonly pages: readonly PrerenderPage[]
  readonly debug?: SSRDebugSnapshot
}

/**
 * 构建时逐页渲染：返回每页的渲染结果 + head + 脱水状态（不写文件）。
 * 典型用法：build 脚本中循环 renderPage(page) 后 writeFile 到 dist/<path>/index.html。
 */
export async function prerenderRoutes(options: PrerenderOptions): Promise<PrerenderResult> {
  const pages: PrerenderPage[] = []
  let debug: SSRDebugSnapshot | undefined

  for (const path of options.routes) {
    // 占位启动路径：保证目标页的 guards/loader 完整执行（同路径 push 会被去重）
    const router = createRouter({
      history: createMemoryHistory('/__vobs_boot__'),
      routes: options.routeRecords
    })
    try {
      const target = await router.push(path)
      if (target === false) {
        throw new Error(`Vobs SSR: 预渲染 ${path} 被导航守卫取消`)
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

/** 把 PrerenderPage 组装成完整 HTML 文档（默认极简壳；template 可整页定制） */
export function renderPage(
  page: PrerenderPage,
  options: {
    /** 客户端入口脚本（如 <script type="module" src="/assets/entry.js"></script>） */
    readonly entryScript?: string
    /** 自定义外壳；默认 <!doctype html><html><head>…</head><body>…</body></html> */
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
