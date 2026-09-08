import { createOwner, state } from '@vobs/reactivity'
import { invokeRuntimeDebug } from './debug'
import { insertDynamic, type NodeFactory } from './dynamic'
import { normalizeVobsError } from './error'

export type BoundaryRetry = () => void | Promise<unknown>
export type BoundaryFallback = (error: Error, retry: BoundaryRetry) => ReturnType<NodeFactory>

export interface BoundaryOptions {
  children: NodeFactory
  fallback: BoundaryFallback
  onRetry?: () => void | Promise<unknown>
  resetKey?: () => unknown
}

/**
 * Shared no-wrapper boundary protocol. The boundary owns its reactive error
 * state and child branch, so replacing the branch also disposes its Owner.
 */
export function insertBoundary(
  parent: Node,
  anchor: Node | null,
  options: BoundaryOptions
): void {
  const boundary = createOwner()
  boundary.run(() => {
    const error = state<Error | null>(null)
    let fallbackActive = false
    let lastError: Error | null = null
    let initialized = false
    let previousKey: unknown

    boundary.onError(reason => {
      if (fallbackActive) throw reason
      const normalized = normalizeVobsError(reason, {
        code: 'VOBS_R001',
        layer: 'runtime',
        fix: '检查组件渲染逻辑，或在边界 fallback 中提供恢复操作。'
      })
      lastError = normalized
      invokeRuntimeDebug('error', {
        error: normalized,
        owner: boundary,
        phase: 'boundary',
        handled: true,
        recovery: 'fallback'
      })
      error.value = normalized
    })

    const retry = (): void | Promise<unknown> => {
      if (error.value) {
        invokeRuntimeDebug('error', {
          error: error.value,
          owner: boundary,
          phase: 'boundary',
          handled: true,
          recovery: 'retrying'
        })
      }
      error.value = null
      return options.onRetry?.()
    }

    insertDynamic(parent, anchor, () => {
      const nextKey = options.resetKey?.()
      if (!initialized || !Object.is(previousKey, nextKey)) {
        initialized = true
        previousKey = nextKey
        if (error.value) error.value = null
      }

      const currentError = error.value
      if (!currentError) {
        if (fallbackActive && lastError) {
          invokeRuntimeDebug('error', {
            error: lastError,
            owner: boundary,
            phase: 'boundary',
            handled: true,
            recovery: 'recovered'
          })
          lastError = null
        }
        fallbackActive = false
        return options.children()
      }

      fallbackActive = true
      return options.fallback(currentError, retry)
    })
  })
}
