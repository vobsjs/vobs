/**
 * **Local preview runtime** for DSH plugins (browser side).
 *
 * Goal: see what a plugin looks like in the browser without installing it into DSH.
 *
 * It does three things:
 *   1. Installs a `window.__ModuleLoader__` shim that intercepts the plugin bundle's factory registration;
 *   2. Replaces DSH's platform modules with a **tiny React implementation** — implementing only
 *      the `createElement` / `useRef` / `useEffect` the adapter really uses, enough to "commit"
 *      the host component into real DOM;
 *   3. Builds a DSH-like shell (left rail / sidebar / main area / right bar / overlay)
 *      and renders each slot entry the plugin registered into its place.
 *
 * It is **not** a DSH emulator: no backend, no cordis, no replication of official component styles.
 * It answers one question — "what does my panel look like when mounted, and does it throw".
 *
 * This module imports nothing, so it can be fed to the browser as a single file.
 */

/* ------------------------------------------------------------------ Types */

export type PreviewFactory = (require: (id: string) => unknown) => unknown

export interface PreviewOptions {
  /** Mount container; the preview builds the whole DSH-like shell inside it. */
  container: HTMLElement
  /** Only start the plugin with this id; defaults to the single one in the registry. */
  packageName?: string
  /** Simulated DSH client services, available via `ctx.get(name)`. */
  services?: Record<string, unknown>
}

export interface PreviewHandle {
  /** Id of the started plugin. */
  readonly id: string
  /** Slot names actually registered to. */
  readonly slots: readonly string[]
  /** Unmount: run cleanups and empty the shell. */
  destroy(): void
}

interface VNode {
  __vnode: true
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/* ------------------------------------------------- Module loader shim */

const PREVIEW_GLOBAL = '__VOBS_DSH_PREVIEW__'

/** Same key as DSH_REACT_GLOBAL in react.ts; this module deliberately does not import it, staying single-file distributable. */
const REACT_GLOBAL = '__VOBS_DSH_REACT__'

interface PreviewGlobal {
  factories: Map<string, PreviewFactory>
}

/** Install (or reuse) the `window.__ModuleLoader__` shim; returns the factory registry. */
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

/** Read the registered factories (without installing the shim). */
export function readLoaderRegistry(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Map<string, PreviewFactory> {
  return (target[PREVIEW_GLOBAL] as PreviewGlobal | undefined)?.factories ?? new Map()
}

/* --------------------------------------------------------- Mini React */

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
 * Only the three APIs the adapter uses.
 *
 * Why we can write this ourselves: `@vobs/dsh`'s host component is always just
 * `createElement('div', { ref, style })` plus one effect —
 * no diffing, no state, no event synthesis needed.
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
  if (currentHooks === null) throw new Error(`preview: ${api} must be called during component rendering`)
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
 * Render a node. Function components commit in the order "render the subtree, then run
 * effects", matching React's commit order — the adapter's effects rely on `ref.current`
 * being in place already.
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

/* --------------------------------------------------------------- Shell */

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

/* --------------------------------------------------------------- Entry */

/**
 * Start the preview.
 *
 * Before calling this, the plugin bundle must already have executed (i.e. the
 * `<script src=".../client.js">` has finished loading), otherwise the registry is empty.
 */
export function startPreview(options: PreviewOptions): PreviewHandle {
  const factories = installLoaderShim()
  const id = options.packageName ?? (factories.size === 1 ? [...factories.keys()][0] : undefined)

  // The adapter's host component gets React through this global. In a bundled artifact it is
  // written by dshBundle()'s bootstrap; the preview writes it again so hand-built plugins
  // and builds with the bootstrap disabled work all the same.
  const globals = globalThis as unknown as Record<string, unknown>
  const previousReact = globals[REACT_GLOBAL]
  globals[REACT_GLOBAL] = previewReact

  const root = options.container
  root.textContent = ''

  const shell = element('div', 'pv')
  const bar = element('div', 'pv__bar')
  bar.appendChild(element('span', 'pv__logo', 'vobs'))
  bar.appendChild(element('span', 'pv__id', id ?? '(no plugin registered)'))
  const slotLabel = element('span', 'pv__slots')
  bar.appendChild(slotLabel)
  bar.appendChild(element('span', 'pv__spacer'))
  const reload = element('button', 'pv__btn', 'Reload')
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
  railSlot.dataset.empty = 'sidebar entry'
  rail.appendChild(railSlot)

  const sidebar = element('div', 'pv__sidebar', 'sidebar (official DSH content)')

  const main = element('div', 'pv__main')
  const mainSlot = element('div', 'pv__slot')
  mainSlot.dataset.empty = 'main slot: this plugin registers no main-area panel'
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
        ? 'No factory captured — make sure client.js has executed and that it calls window.__ModuleLoader__.load'
        : `Registry contains ${[...factories.keys()].join(', ')}, but not ${id ?? '(unspecified)'}`
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
      throw new Error(`preview: the artifact require()d an unprovided module ${moduleId}`)
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
          const name = typeof registration?.name === 'string' ? registration.name : '(anonymous slot)'
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
    else fail(new Error('The artifact did not export a usable plugin (missing apply)'))

    for (const effect of effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
  } catch (error) {
    fail(error)
  }

  slotLabel.textContent = slots.length > 0 ? `slots: ${slots.join(', ')}` : 'no slot registered'
  if (slots.length === 0 && !failed) {
    errorBox.style.display = 'block'
    errorBox.classList.add('pv__warn')
    errorBox.textContent = 'The plugin registered no slots — did apply() run?'
  }

  return {
    id,
    slots,
    destroy() {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {
          // A failing cleanup must not block the remaining ones
        }
      }
      restoreReact()
      root.textContent = ''
    }
  }
}
