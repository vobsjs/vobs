/**
 * dsh-plugin-vobs —— Client 半侧（浏览器 bundle 的入口）。
 *
 * 这个文件会被构建成 `lib/client.js`，形态是：
 *
 *   window.__ModuleLoader__.load({ id: 'dsh-plugin-vobs', factory: function (require) { ... } })
 *
 * DSH 的模块系统只执行 factory 注册，模块副作用（含这里的 CSS 注入）在首次物化时才跑。
 * factory 返回的对象就是浏览器 cordis 树上的插件本体。
 *
 * vobs 在这里的角色：DSH 的 slot 只接受 React 组件，所以这里用一个**极薄的 React 宿主**
 * 占位（<div ref>），真正的 UI 全部由 vobs 挂载到该元素的 shadow root 里渲染。
 * React 由平台模块表提供（`require('react')`），不进入本 bundle。
 */
import { createVobs } from '@vobs/vobs'
import { VobsPanel } from './panel'
import { HOST_STYLE, PANEL_CSS } from './styles'

/** 由 DSH 的 `window.__ModuleLoader__` factory 注入；`react` 是平台内置模块。 */
declare const require: (id: string) => any

const React = require('react') as {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
  useRef: <T>(initial: T) => { current: T }
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void
}

interface SlotsService {
  inject: (name: string, callback: () => unknown) => void
  register: (options: Record<string, unknown>, component: unknown) => unknown
}

interface ClientContext {
  readonly slots: SlotsService
}

/**
 * 取当前配色。DSH 的主题服务把 `color-scheme` 写在根元素上，
 * 读不到就退到 `prefers-color-scheme`，两者都是标准 API。
 */
function resolveScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const declared = (getComputedStyle(document.documentElement).colorScheme ?? '').toLowerCase()
  if (declared.includes('dark')) return 'dark'
  if (declared.includes('light')) return 'light'
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

/**
 * React 宿主：只负责提供一个 DOM 容器。挂载/卸载都在 effect 里，
 * 生命周期跟随 DSH slot 渲染器。
 */
function VobsHost() {
  const holder = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const host = holder.current
    if (!host) return undefined

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    shadow.appendChild(style)

    // 面板根与 <style> 平级：vobs 的 mount 会清空自己的容器，不能连样式一起清掉。
    const root = document.createElement('div')
    root.className = 'vobs-dsh-root'
    root.dataset.scheme = resolveScheme()
    shadow.appendChild(root)

    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
    const onSchemeChange = (): void => {
      root.dataset.scheme = resolveScheme()
    }
    media?.addEventListener('change', onSchemeChange)

    const app = createVobs({ render: () => <VobsPanel /> })
    app.mount(root)

    return () => {
      media?.removeEventListener('change', onSchemeChange)
      app.destroy()
      host.shadowRoot?.replaceChildren()
    }
  }, [])

  return React.createElement('div', { ref: holder, style: HOST_STYLE })
}

/** `slots` 由 @deepseek-ai/dsh-client-ui-renderer 侧提供；cordis 等它就绪后再激活本插件。 */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // shell.overlay 是 @deepseek-ai/dsh-client-ui-layout 声明的 list slot（scope: root），
  // DSH 自家的配额提示、插件管理器 toast 都挂在这里。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'vobs-panel', order: 120 }, VobsHost)
  )
}

/** factory 取值时优先取 default（见 scripts/build-dsh-plugin.mjs 的包装层）。 */
export default { inject, apply }
