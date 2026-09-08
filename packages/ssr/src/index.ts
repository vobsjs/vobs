import { createVobs, type VobsApp, type VobsConfig, type VobsPlugin } from '@vobs/vobs'
import type { DictDehydratedState } from '@vobs/dict'
import type { ResourceClient, ResourceDehydratedState } from '@vobs/resource'
import { pushRuntimeDebugContext } from '@vobs/runtime'
import { subscribeHTTPDebug, type HTTPDebugRequest } from '@vobs/http'
import { createHydrationRenderer } from './hydration'
import { createSSRRenderer } from './renderer'

export { createSSRRenderer } from './renderer'
export { createHydrationRenderer } from './hydration'
export type { SSRComment, SSRElement, SSRNode, SSRRenderer, SSRText } from './renderer'
export type { HydrationRenderer } from './hydration'

export interface AsyncSSRResult {
  readonly html: string
  readonly resources?: ResourceDehydratedState
  readonly dict?: DictDehydratedState
  readonly state?: SSRState
  readonly debug?: SSRDebugSnapshot
}

/** Explicit side-channel for server-only request diagnostics. */
export interface SSRDebugSnapshot {
  readonly version: 1
  readonly environment: 'server'
  readonly startedAt: number
  readonly endedAt: number
  readonly requests: readonly HTTPDebugRequest[]
}

export interface SSRState {
  readonly version: 1
  readonly resources?: ResourceDehydratedState
  readonly dict?: DictDehydratedState
  readonly i18n?: I18nSSRState
  readonly theme?: ThemeSSRState
}

export interface I18nSSRState {
  readonly version: 1
  readonly locale: string
  readonly messages: Readonly<Record<string, unknown>>
}

export interface ThemeSSRState {
  readonly version: 1
  readonly mode: 'light' | 'dark' | 'system'
  readonly overrides: Readonly<Record<string, unknown>>
}

export interface I18nSSRContext {
  dehydrate(): I18nSSRState
  hydrate(snapshot: unknown): void
}

export interface ThemeSSRContext {
  dehydrate(): ThemeSSRState
  hydrate(snapshot: unknown): void
}

export interface DictSSRContext {
  dehydrate(): DictDehydratedState
  hydrate(snapshot: unknown): void
}

export interface SSRStateOptions {
  readonly resourceClient?: ResourceClient
  readonly dict?: DictSSRContext
  readonly i18n?: I18nSSRContext
  readonly theme?: ThemeSSRContext
}

export interface AsyncSSROptions extends SSRStateOptions {
  plugins?: VobsPlugin[]
  readonly debug?: {
    /** Capture Vobs HTTP events and return them for an explicit client import. */
    readonly captureRequests?: boolean
  }
}

export function renderToString(
  render: VobsConfig['render'],
  options: { plugins?: VobsPlugin[] } = {}
): string {
  const ssr = createSSRRenderer()
  const app = createVobs({
    render,
    renderer: ssr.renderer,
    plugins: options.plugins
  })

  try {
    app.mount(ssr.container)
    return ssr.toHTML()
  } finally {
    app.destroy()
  }
}

export async function renderToStringAsync(
  render: VobsConfig['render'],
  options: AsyncSSROptions = {}
): Promise<AsyncSSRResult> {
  const ssr = createSSRRenderer()
  const app = createVobs({
    render,
    renderer: ssr.renderer,
    plugins: options.plugins
  })
  const captureRequests = options.debug?.captureRequests === true
  const requests: HTTPDebugRequest[] = []
  const startedAt = Date.now()
  const stopDebug = captureRequests ? subscribeHTTPDebug(event => {
    requests.push({
      ...event,
      context: { environment: 'server', ...event.context }
    })
  }) : () => undefined
  const restoreDebugContext = captureRequests
    ? pushRuntimeDebugContext({ environment: 'server' })
    : () => undefined

  try {
    app.mount(ssr.container)
    await options.resourceClient?.prefetchAll()
    app.update()
    const endedAt = Date.now()
    return {
      html: ssr.toHTML(),
      resources: options.resourceClient?.dehydrate(),
      dict: options.dict?.dehydrate(),
      state: createState(options),
      debug: captureRequests ? {
        version: 1,
        environment: 'server',
        startedAt,
        endedAt,
        requests
      } : undefined
    }
  } finally {
    restoreDebugContext()
    stopDebug()
    app.destroy()
  }
}

export function hydrate(
  render: VobsConfig['render'],
  target: string | Element,
  options: SSRStateOptions & { plugins?: VobsPlugin[]; state?: SSRState | string } = {}
): VobsApp<Node> {
  const container = typeof target === 'string' ? document.querySelector(target) : target
  if (!container) throw new Error(`hydrate: 目标不存在: ${target}`)

  const restored = options.state ? parseState(options.state) : undefined
  if (restored?.resources && options.resourceClient) options.resourceClient.hydrate(restored.resources)
  if (restored?.dict && options.dict) options.dict.hydrate(restored.dict)
  if (restored?.i18n && options.i18n) options.i18n.hydrate(restored.i18n)
  if (restored?.theme && options.theme) options.theme.hydrate(restored.theme)

  const hydration = createHydrationRenderer(container)
  const app = createVobs({
    render,
    renderer: hydration.renderer,
    plugins: options.plugins
  })
  app.hydrate(container)
  return app
}

export function createState(options: SSRStateOptions): SSRState {
  return {
    version: 1,
    resources: options.resourceClient?.dehydrate(),
    dict: options.dict?.dehydrate(),
    i18n: options.i18n?.dehydrate(),
    theme: options.theme?.dehydrate()
  }
}

export function serializeState(state: SSRState): string {
  const serialized = JSON.stringify(state)
  return serialized
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function parseState(snapshot: unknown): SSRState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs SSR: 初始状态不是有效 JSON')
    }
  }
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    throw new Error('Vobs SSR: 初始状态版本或格式无效')
  }
  const state = value as SSRState
  if (state.i18n !== undefined) validateI18nState(state.i18n)
  return state
}

function validateI18nState(value: I18nSSRState): void {
  if (!value || typeof value !== 'object' || value.version !== 1
    || typeof value.locale !== 'string' || !value.locale.trim()
    || !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages)) {
    throw new Error('Vobs SSR: i18n 初始状态版本或格式无效')
  }
  for (const [locale, messages] of Object.entries(value.messages)) {
    if (!locale.trim() || !isMessageObject(messages)) throw new Error('Vobs SSR: i18n messages 格式无效')
  }
}

function isMessageObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(entry => typeof entry === 'string' || isMessageObject(entry))
}
