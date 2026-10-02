import { createVobs, type VobsConfig, type VobsPlugin } from '@vobs/vobs'
import type { DictDehydratedState } from '@vobs/dict'
import type { ResourceClient, ResourceDehydratedState } from '@vobs/resource'
import { pushRuntimeDebugContext, setRenderer } from '@vobs/runtime'
import { subscribeHTTPDebug, type HTTPDebugRequest } from '@vobs/http'
import type { ResourceFailure } from '@vobs/resource'
import { createSSRRenderer } from './renderer'

/** Async SSR result: HTML plus dehydrated client state. */
export interface AsyncSSRResult {
  readonly html: string
  readonly resources?: ResourceDehydratedState
  readonly dict?: DictDehydratedState
  readonly state?: SSRState
  /**
   * 这轮 SSR 里**失败**的资源（`ResourceClient.errors()` 的快照），**仅在非空时出现**。
   *
   * 存在的理由：`prefetchAll()` 刻意不抛错（一个请求失败不该让整页 500），而 `dehydrate()` 又会
   * 剔除失败项 —— 于是服务端会安安静静地返回一份"用残缺数据渲染"的 HTML。有了这个字段，
   * 服务端至少能把"这次渲染有失败资源"记进日志/监控，而不是等用户看到空列表。
   */
  readonly failedResources?: readonly ResourceFailure[]
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
  readonly mode: 'light' | 'dark' | 'system'
  readonly overrides: Readonly<Record<string, unknown>>
  readonly version: 1
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
  /**
   * 异步 SSR 冲刷到"渲染结果不再变化"的最大轮数（默认 10）。
   * 用于兜住"数据到达后又排了若干跳异步工作"的情况；设 1 即退回旧的单次 update 行为。
   */
  readonly maxFlushRounds?: number
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
    /*
     * `setRenderer` 是进程级单例且没有 async context：上面这个 await 期间，另一个
     * renderToString / renderToStringAsync 可能已经装上了它自己的渲染器。刷新前把自己这一份
     * 重新装上 —— 否则这次 update 会用别人的渲染器写自己的树。
     * 残留局限：两个 async 渲染真正交错时仍是"最后装上的赢"，彻底解决需要按 owner 携带渲染器。
     */
    setRenderer(ssr.renderer)
    /*
     * 冲刷到**稳定**为止，而不是只 update 一次。
     *
     * `await prefetchAll()` 只解决第一跳：数据到达后，绑定 effect 里可能还有链式 promise/`await`，
     * 或者本次写入又触发新的 effect —— 它们要再经过若干轮微任务才就绪。只 `app.update()` 一次，
     * 这些内容就**静默缺失**（HTML 里留着占位或旧值，既不报错也没有任何线索）。
     *
     * 循环判据是"渲染结果不再变化"（不是固定次数），并设上限防死循环；
     * 每轮都重装自己的渲染器（`setRenderer` 是进程级单例，await 期间可能被别人换掉）。
     */
    const maxFlushRounds = Math.max(1, options.maxFlushRounds ?? 10)
    let previousHTML = ''
    for (let round = 0; round < maxFlushRounds; round += 1) {
      setRenderer(ssr.renderer)
      app.update()
      const html = ssr.toHTML()
      if (html === previousHTML) break
      previousHTML = html
      // 让排队中的异步工作推进一轮（宏任务：把已排队的微任务链全部放行）
      await new Promise(resolve => { setTimeout(resolve, 0) })
    }
    const endedAt = Date.now()
    // `errors` 是后加的只读视图；用可选调用保持对旧 stub/旧 client 的兼容
    const failedResources = options.resourceClient?.errors?.() ?? []
    return {
      html: ssr.toHTML(),
      resources: options.resourceClient?.dehydrate(),
      dict: options.dict?.dehydrate(),
      state: createState(options),
      ...(failedResources.length > 0 ? { failedResources } : {}),
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
