import type { Owner } from '@vobs/reactivity'

export type RuntimeDebugEnvironment = 'client' | 'server'

/**
 * Lightweight context copied onto debug events created synchronously inside a
 * Router loader, Effect or SSR render. It is intentionally optional so the
 * runtime remains useful without DevTools.
 */
export interface RuntimeDebugContext {
  readonly environment?: RuntimeDebugEnvironment
  readonly sessionId?: string
  readonly route?: string
  readonly navigationId?: number
  readonly dataRequestId?: number
  readonly updateId?: string
  readonly effectId?: string
  readonly source?: string
}

export interface RuntimeHydrationMismatch {
  readonly kind: 'missing-node' | 'extra-node' | 'position' | 'content'
  readonly expected: string
  readonly actual: string
  readonly path: string
  readonly message: string
}

export type RuntimeDomMutationOperation = 'text' | 'property' | 'attribute' | 'insert' | 'remove'

export interface RuntimeDomMutation {
  readonly operation: RuntimeDomMutationOperation
  readonly target: string
  readonly parent?: string
  readonly key?: string
  readonly previousValue?: unknown
  readonly nextValue?: unknown
}

export interface RuntimeErrorEvent {
  readonly error: unknown
  readonly owner: Owner
  readonly phase: 'event' | 'boundary'
  readonly handled: boolean
  readonly recovery: 'propagated' | 'handled' | 'fallback' | 'retrying' | 'recovered'
}

export interface RuntimeDebugHooks {
  domMutation?(mutation: RuntimeDomMutation): void
  error?(event: RuntimeErrorEvent): void
  hydrationMismatch?(event: RuntimeHydrationMismatch): void
}

let activeRuntimeDebugHooks: RuntimeDebugHooks | null = null
let activeRuntimeDebugContext: RuntimeDebugContext | null = null

export function setRuntimeDebugHooks(hooks: RuntimeDebugHooks | null): RuntimeDebugHooks | null {
  const previous = activeRuntimeDebugHooks
  activeRuntimeDebugHooks = hooks
  return previous
}

export function getRuntimeDebugHooks(): RuntimeDebugHooks | null {
  return activeRuntimeDebugHooks
}

export function getRuntimeDebugContext(): RuntimeDebugContext | null {
  return activeRuntimeDebugContext
}

/** Run a synchronous operation with trace context, preserving async renders. */
export function runWithRuntimeDebugContext<T>(context: RuntimeDebugContext, task: () => T): T {
  const previous = activeRuntimeDebugContext
  const next = { ...previous, ...context }
  activeRuntimeDebugContext = next
  let result: T
  try {
    result = task()
  } catch (error) {
    activeRuntimeDebugContext = previous
    throw error
  }
  if (isPromiseLike(result)) {
    return Promise.resolve(result).finally(() => {
      if (activeRuntimeDebugContext === next) activeRuntimeDebugContext = previous
    }) as T
  }
  activeRuntimeDebugContext = previous
  return result
}

/** Keep a context active across callback boundaries such as Effect execution. */
export function pushRuntimeDebugContext(context: RuntimeDebugContext): () => void {
  const previous = activeRuntimeDebugContext
  activeRuntimeDebugContext = { ...previous, ...context }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    activeRuntimeDebugContext = previous
  }
}

export function invokeRuntimeDebug<K extends keyof RuntimeDebugHooks>(
  name: K,
  ...args: Parameters<NonNullable<RuntimeDebugHooks[K]>>
): void {
  const callback = activeRuntimeDebugHooks?.[name] as ((...values: unknown[]) => void) | undefined
  if (!callback) return
  try {
    callback(...args)
  } catch {
    // Debug tooling must never change runtime behavior.
  }
}

export function readDebugValue(read: () => unknown): unknown {
  try {
    return read()
  } catch {
    return '[Uninspectable]'
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
}

export function describeDebugNode(node: unknown): string {
  if (!node || typeof node !== 'object') return 'node'
  const value = node as {
    readonly nodeName?: unknown
    readonly tagName?: unknown
    readonly id?: unknown
    readonly className?: unknown
  }
  const name = typeof value.tagName === 'string'
    ? value.tagName.toLowerCase()
    : typeof value.nodeName === 'string' ? value.nodeName.toLowerCase() : 'node'
  const id = typeof value.id === 'string' && value.id ? `#${value.id}` : ''
  const className = typeof value.className === 'string' && value.className
    ? `.${value.className.trim().split(/\s+/).filter(Boolean).join('.')}`
    : ''
  return `${name}${id}${className}`
}
