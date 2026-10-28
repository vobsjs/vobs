import { createOwner, state } from '@vobs/reactivity'
import { getRuntimeDebugHooks, invokeRuntimeDebug, type RuntimeErrorEvent } from './debug'
import { insertDynamic, type NodeFactory } from './dynamic'
import { formatVobsError, normalizeVobsError } from './error'

export type BoundaryRetry = () => void | Promise<unknown>
export type BoundaryFallback = (error: Error, retry: BoundaryRetry) => ReturnType<NodeFactory>

/**
 * Errors captured by a boundary must be visible to someone.
 *
 * It used to only call `invokeRuntimeDebug('error', …)` — when DevTools was not installed
 * (and thus there was no error hook), the console printed **nothing at all**: the error was
 * swapped for the fallback and the scene left without a trace. This is the most expensive
 * kind of silence to debug. When hooks are installed, delegate to them (avoiding duplicate
 * output); otherwise print to the console.
 *
 * @param loud Only "an error was really swallowed" deserves noise; retrying / recovered are
 * informational and stay out of the console.
 */
function reportBoundaryError(event: RuntimeErrorEvent, loud: boolean): void {
  invokeRuntimeDebug('error', event)
  if (loud && getRuntimeDebugHooks()?.error === undefined) {
    console.error(formatVobsError(event.error, { includeStack: true }))
  }
}

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
    const error = state<Error | null>(null, 'error')
    let fallbackActive = false
    let lastError: Error | null = null
    let initialized = false
    let previousKey: unknown

    boundary.onError(reason => {
      if (fallbackActive) throw reason
      const normalized = normalizeVobsError(reason, {
        code: 'VOBS_R001',
        layer: 'runtime',
        fix: 'Check the component render logic, or provide a recovery action in the boundary fallback.'
      })
      lastError = normalized
      reportBoundaryError({
        error: normalized,
        owner: boundary,
        phase: 'boundary',
        handled: true,
        recovery: 'fallback'
      }, true)
      error.value = normalized
    })

    const retry = (): void | Promise<unknown> => {
      if (error.value) {
        reportBoundaryError({
          error: error.value,
          owner: boundary,
          phase: 'boundary',
          handled: true,
          recovery: 'retrying'
        }, false)
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
          reportBoundaryError({
            error: lastError,
            owner: boundary,
            phase: 'boundary',
            handled: true,
            recovery: 'recovered'
          }, false)
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
