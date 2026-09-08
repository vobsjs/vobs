import { createOwner, state } from '@vobs/reactivity'
import { insertDynamic, type NodeFactory } from './dynamic'
import { createFragment, type VobsNode } from './fragment'

export type AsyncBoundaryView = ReturnType<NodeFactory> | NodeFactory
export type AsyncBoundaryFallback = (error: Error, retry: () => void) => ReturnType<NodeFactory>
export interface AsyncBoundaryOptions<T> {
  promise: PromiseLike<T> | (() => PromiseLike<T>)
  children: (value: T) => ReturnType<NodeFactory>
  loading?: AsyncBoundaryView
  fallback?: AsyncBoundaryFallback
  resetKey?: () => unknown
}
export interface AsyncBoundaryProps<T> extends AsyncBoundaryOptions<T> {}

export function insertAsyncBoundary<T>(parent: Node, anchor: Node | null, options: AsyncBoundaryOptions<T>): void {
  const boundary = createOwner()
  boundary.run(() => {
    const loading = state(true)
    const data = state<T | undefined>(undefined)
    const resolved = state(false)
    const error = state<Error | null>(null)
    let token = 0
    let previousKey: unknown
    let initialized = false
    let fallbackActive = false
    boundary.onError(reason => {
      if (fallbackActive) throw reason
      error.value = normalizeError(reason)
      loading.value = false
    })

    const start = (): void => {
      const current = ++token
      loading.value = true
      error.value = null
      data.value = undefined
      resolved.value = false
      let promise: PromiseLike<T>
      try {
        promise = typeof options.promise === 'function' ? options.promise() : options.promise
      } catch (reason) {
        if (current === token) {
          loading.value = false
          error.value = normalizeError(reason)
        }
        return
      }
      Promise.resolve(promise).then(value => {
        if (current !== token || boundary.disposed) return
        data.value = value
        resolved.value = true
        loading.value = false
      }, reason => {
        if (current !== token || boundary.disposed) return
        error.value = normalizeError(reason)
        loading.value = false
      })
    }

    const retry = (): void => start()
    start()
    insertDynamic(parent, anchor, () => {
      const key = options.resetKey?.()
      if (!initialized) {
        initialized = true
        previousKey = key
      } else if (!Object.is(previousKey, key)) {
        previousKey = key
        start()
      }
      if (loading.value) {
        fallbackActive = false
        return resolveView(options.loading)
      }
      if (error.value) {
        fallbackActive = true
        return options.fallback?.(error.value, retry) ?? null
      }
      fallbackActive = false
      return resolved.value ? options.children(data.value as T) : resolveView(options.loading)
    })
  })
}

export function AsyncBoundary<T>(props: AsyncBoundaryProps<T>): VobsNode {
  return createFragment((parent, anchor) => insertAsyncBoundary(parent, anchor, props))
}

function resolveView(view: AsyncBoundaryView | undefined): ReturnType<NodeFactory> {
  if (!view) return null
  return typeof view === 'function' ? view() : view
}

function normalizeError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}
