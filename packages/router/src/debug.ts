import type { RuntimeDebugContext } from '@vobs/runtime'

export type RouterDebugEventType =
  | 'navigation:start'
  | 'navigation:end'
  | 'route:update'
  | 'data-request'
  | 'error'

export interface RouterDebugEvent {
  readonly routerId: string
  readonly type: RouterDebugEventType
  readonly payload: unknown
  readonly context?: RuntimeDebugContext
}

type RouterDebugListener = (event: RouterDebugEvent) => void

const listeners = new Set<RouterDebugListener>()
let nextRouterId = 1

export function createRouterDebugId(): string {
  return `router-${nextRouterId++}`
}

export function subscribeRouterDebug(listener: RouterDebugListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitRouterDebug(
  routerId: string,
  type: RouterDebugEventType,
  payload: unknown,
  context?: RuntimeDebugContext
): void {
  const event: RouterDebugEvent = { routerId, type, payload, context }
  for (const listener of [...listeners]) {
    try { listener(event) } catch { /* diagnostics must not affect navigation */ }
  }
}
