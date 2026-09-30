/**
 * DSH 插件的**本地预览运行时**（浏览器侧）。
 *
 * 目标：不用把插件装进 DSH，也能在浏览器里看到它长什么样。
 *
 * 它做三件事：
 *   1. 装一个 `window.__ModuleLoader__` 垫片，截住插件 bundle 的 factory 注册；
 *   2. 用一份**极小的 React 实现**替掉 DSH 的平台模块 —— 只实现适配层真正用到的
 *      `createElement` / `useRef` / `useEffect`，足够把宿主组件「提交」成真实 DOM；
 *   3. 造一个仿 DSH 的外壳（左轨道 / 侧栏 / 主区域 / 右栏 / 浮层），
 *      把插件注册的每个 slot 条目渲染到对应位置。
 *
 * 它**不是** DSH 的模拟器：不连后端、不实现 cordis、不还原官方组件的样式。
 * 它只回答一个问题 —— 「我的面板挂上去长什么样、会不会报错」。
 *
 * 本模块不 import 任何东西，因此可以被当作单文件直接喂给浏览器。
 */

/* ------------------------------------------------------------------ 类型 */

export type PreviewFactory = (require: (id: string) => unknown) => unknown

export interface PreviewOptions {
  /** 挂载容器；预览会在这个容器里建出整个仿 DSH 外壳。 */
  container: HTMLElement
  /** 只启动指定 id 的插件；缺省取注册表里唯一的一个。 */
  packageName?: string
  /** 模拟的 DSH 客户端服务，供 `ctx.get(name)` 取用。 */
  services?: Record<string, unknown>
}

export interface PreviewHandle {
  /** 被启动的插件 id。 */
  readonly id: string
  /** 实际注册到的 slot 名。 */
  readonly slots: readonly string[]
  /** 卸载：跑清理函数并清空外壳。 */
  destroy(): void
}

interface VNode {
  __vnode: true
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/* ------------------------------------------------------- 模块加载器垫片 */

const PREVIEW_GLOBAL = '__VOBS_DSH_PREVIEW__'

/** 与 react.ts 的 DSH_REACT_GLOBAL 同一个键；本模块刻意不 import，保持可单文件分发。 */
const REACT_GLOBAL = '__VOBS_DSH_REACT__'

interface PreviewGlobal {
  factories: Map<string, PreviewFactory>
}

/** 装（或复用）`window.__ModuleLoader__` 垫片，返回 factory 注册表。 */
export function installLoaderShim(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Map<string, PreviewFactory> {
  const existing = target[PREVIEW_GLOBAL] as PreviewGlobal | undefined
  if (existing !== undefined && existing.factories instanceof Map) return existing.factories

  const state: PreviewGlobal = { factories: new Map() }
  target[PREVIEW_GLOBAL] = state
  target.__ModuleLoader__ = {
    load(entry: { id?: unknown; factory?: unknown }) {
      if (typeof entry?.id !== 'string' || typeof entry.factory !== 'function') return
      state.factories.set(entry.id, entry.factory as PreviewFactory)
    }
  }
  return state.factories
}

/** 读取已注册的 factory（不装垫片）。 */
export function readLoaderRegistry(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Map<string, PreviewFactory> {
  return (target[PREVIEW_GLOBAL] as PreviewGlobal | undefined)?.factories ?? new Map()
}

/* --------------------------------------------------------- 迷你 React */

interface HookState {
  refs: unknown[]
  effects: Array<() => void | (() => void)>
  index: number
}

let currentHooks: HookState | null = null

interface ReactShim {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): VNode
  useRef<T>(initial: T | null): { current: T | null }
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/**
 * 只实现适配层用到的三个 API。
 *
 * 之所以自己能写：`@vobs/dsh` 的宿主组件永远只有
 * `createElement('div', { ref, style })` + 一个 effect，
 * 不需要 diff、不需要状态、不需要事件合成。
 */
export const previewReact: ReactShim = {
  createElement(type, props, ...children): VNode {
    return { __vnode: true, type, props: props ?? {}, children }
  },
  useRef<T>(initial: T | null): { current: T | null } {
    const hooks = requireHooks('useRef')
    const slot = hooks.index++
    if (!(slot in hooks.refs)) hooks.refs[slot] = { current: initial }
    return hooks.refs[slot] as { current: T | null }
  },
  useEffect(effect: () => void | (() => void)): void {
    requireHooks('useEffect').effects.push(effect)
  }
}

function requireHooks(api: string): HookState {
  if (currentHooks === null) throw new Error(`preview: ${api} 必须在组件渲染期间调用`)
  return currentHooks
}

const isVNode = (value: unknown): value is VNode =>
  typeof value === 'object' && value !== null && (value as VNode).__vnode === true

function applyProps(element: HTMLElement, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'ref') {
      if (typeof value === 'object' && value !== null) (value as { current: unknown }).current = element
      continue
    }
    if (key === 'style' && typeof value === 'object' && value !== null) {
      Object.assign(element.style, value as Record<string, string>)
      continue
    }
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (value === false || value === null || value === undefined) continue
    if (key === 'className') {
      element.className = String(value)
      continue
    }
    if (key === 'value' && element instanceof HTMLInputElement) {
      element.value = String(value)
      continue
    }
    element.setAttribute(key, String(value))
  }
}

/**
 * 渲染一个节点。函数组件按「先渲染子树、再跑 effect」的顺序提交，
 * 与 React 的 commit 顺序一致 —— 适配层的 effect 依赖 `ref.current` 已经就位。
 */
function renderNode(node: unknown, parent: Node, cleanups: Array<() => void>): void {
  if (node === null || node === undefined || node === false || node === true) return

  if (Array.isArray(node)) {
    for (const child of node) renderNode(child, parent, cleanups)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    parent.appendChild(document.createTextNode(String(node)))
    return
  }
  if (node instanceof Node) {
    parent.appendChild(node)
    return
  }
  if (!isVNode(node)) return

  if (typeof node.type === 'function') {
    const hooks: HookState = { refs: [], effects: [], index: 0 }
    const previous = currentHooks
    currentHooks = hooks
    let output: unknown
    try {
      output = (node.type as (props: Record<string, unknown>) => unknown)(node.props)
    } finally {
      currentHooks = previous
    }
    renderNode(output, parent, cleanups)
    for (const effect of hooks.effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
    return
  }

  const element = document.createElement(String(node.type))
  applyProps(element, node.props)
  parent.appendChild(element)
  for (const child of node.children) renderNode(child, element, cleanups)
}

/* ------------------------------------------------------------- 外壳 */

const SLOT_TARGETS: Record<string, string> = {
  main: 'main',
  'sidebar.panellist': 'rail',
  'shell.overlay': 'overlay',
  'sidebar.right.pane.tab': 'rightbar',
  'sidebar.right.pane.tab.title': 'rightbar',
  'settings.section': 'main',
  'tool.call.toolview': 'main',
  'conversation.chat.node': 'main',
  'conversation.chat.turnTail': 'main'
}

const FRAME_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; height: 100vh; background: #101013; color: #e9eaf0;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.pv { display: flex; flex-direction: column; height: 100vh; }
.pv__bar {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  border-bottom: 1px solid #ffffff14; background: #17171a; font-size: 12px;
}
.pv__logo { font-weight: 700; color: #8f80ff; }
.pv__id { color: #cfd3d6; }
.pv__slots { color: #81858c; }
.pv__spacer { flex: 1; }
.pv__btn {
  border: 1px solid #ffffff29; background: transparent; color: inherit;
  border-radius: 7px; padding: 3px 10px; font: inherit; cursor: pointer;
}
.pv__btn:hover { background: #ffffff14; }
.pv__warn { color: #f7ad31; }
.pv__error {
  margin: 10px 14px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid #f25a5a55; background: #f25a5a14; color: #f25a5a;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap;
}
.pv__frame { flex: 1; min-height: 0; display: flex; position: relative; }
.pv__rail {
  width: 56px; flex: none; border-right: 1px solid #ffffff14;
  display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 0;
}
.pv__slot { border-radius: 10px; }
.pv__slot:empty::after {
  content: attr(data-empty); display: block; padding: 6px;
  color: #4b5057; font-size: 10px; text-align: center;
}
.pv__sidebar {
  width: 240px; flex: none; border-right: 1px solid #ffffff14; padding: 12px;
  color: #4b5057; font-size: 11px;
}
.pv__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pv__main > .pv__slot { flex: 1; min-height: 0; }
.pv__rightbar { width: 320px; flex: none; border-left: 1px solid #ffffff14; padding: 10px; }
.pv__overlay { position: absolute; inset: 0; pointer-events: none; }
.pv__overlay > * { pointer-events: auto; }
.pv__hint {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  color: #4b5057; font-size: 12px; text-align: center; pointer-events: none;
}
`

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/* --------------------------------------------------------------- 入口 */

/**
 * 启动预览。
 *
 * 调用前，插件 bundle 必须已经执行过（也就是 `<script src=".../client.js">` 已经跑完），
 * 否则注册表是空的。
 */
export function startPreview(options: PreviewOptions): PreviewHandle {
  const factories = installLoaderShim()
  const id = options.packageName ?? (factories.size === 1 ? [...factories.keys()][0] : undefined)

  // 适配层的宿主组件通过这个全局拿 React。打包好的 bundle 里由 dshBundle() 的引导写入；
  // 预览自己再写一次，这样手工构造的插件、或关了引导的构建同样能跑。
  const globals = globalThis as unknown as Record<string, unknown>
  const previousReact = globals[REACT_GLOBAL]
  globals[REACT_GLOBAL] = previewReact

  const root = options.container
  root.textContent = ''

  const shell = element('div', 'pv')
  const bar = element('div', 'pv__bar')
  bar.appendChild(element('span', 'pv__logo', 'vobs'))
  bar.appendChild(element('span', 'pv__id', id ?? '(未注册任何插件)'))
  const slotLabel = element('span', 'pv__slots')
  bar.appendChild(slotLabel)
  bar.appendChild(element('span', 'pv__spacer'))
  const reload = element('button', 'pv__btn', '重新加载')
  reload.addEventListener('click', () => {
    location.reload()
  })
  bar.appendChild(reload)
  shell.appendChild(bar)

  const errorBox = element('div', 'pv__error')
  errorBox.style.display = 'none'
  shell.appendChild(errorBox)

  const frame = element('div', 'pv__frame')
  const rail = element('div', 'pv__rail')
  const railSlot = element('div', 'pv__slot')
  railSlot.dataset.empty = '侧栏入口'
  rail.appendChild(railSlot)

  const sidebar = element('div', 'pv__sidebar', 'sidebar（DSH 官方内容）')

  const main = element('div', 'pv__main')
  const mainSlot = element('div', 'pv__slot')
  mainSlot.dataset.empty = 'main slot：本插件没有注册主区域面板'
  main.appendChild(mainSlot)

  const rightbar = element('div', 'pv__rightbar')
  const rightSlot = element('div', 'pv__slot')
  rightSlot.dataset.empty = 'rightbar'
  rightbar.appendChild(rightSlot)

  const overlay = element('div', 'pv__overlay')
  const overlaySlot = element('div', 'pv__slot')
  overlay.appendChild(overlaySlot)

  frame.append(rail, sidebar, main, rightbar, overlay)
  shell.appendChild(frame)
  root.appendChild(shell)

  const style = document.createElement('style')
  style.textContent = FRAME_CSS
  shell.prepend(style)

  const cleanups: Array<() => void> = []
  const slots: string[] = []
  let failed = false

  const fail = (error: unknown): void => {
    failed = true
    errorBox.style.display = 'block'
    errorBox.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
    console.error('[vobs preview]', error)
  }

  const restoreReact = (): void => {
    if (previousReact === undefined) delete globals[REACT_GLOBAL]
    else globals[REACT_GLOBAL] = previousReact
  }

  if (id === undefined || !factories.has(id)) {
    const hint = element('div', 'pv__hint')
    hint.textContent =
      factories.size === 0
        ? '没有捕获到任何 factory —— 确认 client.js 已经执行，且它调用的是 window.__ModuleLoader__.load'
        : `注册表里有 ${[...factories.keys()].join(', ')}，但没有 ${id ?? '(未指定)'}`
    frame.appendChild(hint)
    return {
      id: id ?? '',
      slots,
      destroy() {
        restoreReact()
        root.textContent = ''
      }
    }
  }

  try {
    const factory = factories.get(id) as PreviewFactory
    const plugin = factory((moduleId: string) => {
      if (moduleId === 'react' || moduleId === 'react-dom') return previewReact
      const service = options.services?.[moduleId]
      if (service !== undefined) return service
      throw new Error(`preview: 产物 require 了未提供的模块 ${moduleId}`)
    }) as { apply?: (ctx: unknown) => void }

    const targets: Record<string, HTMLElement> = {
      rail: railSlot,
      main: mainSlot,
      rightbar: rightSlot,
      overlay: overlaySlot
    }
    const effects: Array<() => void | (() => void)> = []

    const ctx = {
      slots: {
        inject(_name: string, callback: () => unknown) {
          callback()
        },
        register(registration: { name?: unknown }, component: unknown) {
          const name = typeof registration?.name === 'string' ? registration.name : '(匿名 slot)'
          slots.push(name)
          const target = targets[SLOT_TARGETS[name] ?? 'main'] as HTMLElement
          try {
            renderNode(previewReact.createElement(component as () => unknown), target, cleanups)
          } catch (error) {
            fail(error)
          }
          return () => {}
        },
        entries() {
          return []
        }
      },
      effect(callback: () => void | (() => void)) {
        effects.push(callback)
      },
      get(name: string) {
        return options.services?.[name]
      },
      reflect: {
        provide() {
          return () => {}
        }
      }
    }

    if (typeof plugin?.apply === 'function') plugin.apply(ctx)
    else fail(new Error('产物没有导出可用的插件（缺 apply）'))

    for (const effect of effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
  } catch (error) {
    fail(error)
  }

  slotLabel.textContent = slots.length > 0 ? `slots: ${slots.join(', ')}` : '没有注册任何 slot'
  if (slots.length === 0 && !failed) {
    errorBox.style.display = 'block'
    errorBox.classList.add('pv__warn')
    errorBox.textContent = '插件没有注册任何 slot —— apply() 跑了吗？'
  }

  return {
    id,
    slots,
    destroy() {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {
          // 清理失败不应阻断其余清理
        }
      }
      restoreReact()
      root.textContent = ''
    }
  }
}
