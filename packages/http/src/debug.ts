import type { HTTPMethod, HTTPHeaders } from './index'
import type { RuntimeDebugContext } from '@vobs/runtime'

export type HTTPDebugStatus = 'loading' | 'retrying' | 'success' | 'error' | 'cancelled'

export type HTTPDebugCacheStatus = 'hit' | 'miss' | 'revalidated'

export interface HTTPDebugContext extends RuntimeDebugContext {
  readonly cacheStatus?: HTTPDebugCacheStatus
  /** Marks a request created from the DevTools request tester. */
  readonly test?: boolean
}

export interface HTTPDebugRequest {
  readonly id: number
  readonly phase: 'start' | 'retry' | 'end'
  readonly status: HTTPDebugStatus
  readonly url: string
  readonly method: HTTPMethod
  readonly headers: HTTPHeaders
  readonly requestBody?: unknown
  readonly startedAt: number
  readonly endedAt?: number
  readonly duration?: number
  readonly attempt: number
  readonly retries: number
  readonly responseStatus?: number
  readonly responseBody?: unknown
  readonly error?: { readonly name: string; readonly message: string }
  readonly context?: HTTPDebugContext
}

export interface HTTPDebugHooks {
  request?(event: HTTPDebugRequest): void
}

let activeHTTPDebugHooks: HTTPDebugHooks | null = null
const httpDebugListeners = new Set<NonNullable<HTTPDebugHooks['request']>>()

export function setHTTPDebugHooks(hooks: HTTPDebugHooks | null): HTTPDebugHooks | null {
  const previous = activeHTTPDebugHooks
  activeHTTPDebugHooks = hooks
  return previous
}

export function getHTTPDebugHooks(): HTTPDebugHooks | null {
  return activeHTTPDebugHooks
}

export function subscribeHTTPDebug(listener: NonNullable<HTTPDebugHooks['request']>): () => void {
  httpDebugListeners.add(listener)
  return () => httpDebugListeners.delete(listener)
}

export function emitHTTPDebug(event: HTTPDebugRequest): void {
  try {
    activeHTTPDebugHooks?.request?.(event)
  } catch {
    // Debug tooling must never change request behavior.
  }
  for (const listener of [...httpDebugListeners]) {
    try { listener(event) } catch { /* Debug tooling must never change request behavior. */ }
  }
}
