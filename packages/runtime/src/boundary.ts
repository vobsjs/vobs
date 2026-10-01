import { createOwner, state } from '@vobs/reactivity'
import { getRuntimeDebugHooks, invokeRuntimeDebug, type RuntimeErrorEvent } from './debug'
import { insertDynamic, type NodeFactory } from './dynamic'
import { formatVobsError, normalizeVobsError } from './error'

export type BoundaryRetry = () => void | Promise<unknown>
export type BoundaryFallback = (error: Error, retry: BoundaryRetry) => ReturnType<NodeFactory>

/**
 * 边界捕获到的错误必须有人看得见。
 *
 * 原来只调 `invokeRuntimeDebug('error', …)` —— 没装 DevTools（也就没有 error 钩子）时
 * 控制台**一个字都不输出**：错误被替换成 fallback，现场再无痕迹。这是排查成本最高的一种
 * 静默。装了钩子就交给它（避免重复输出），没装就打到控制台。
 *
 * @param loud 只有「真的吞下了错误」才需要吵；retrying / recovered 属于信息，不进控制台。
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
