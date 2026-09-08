import { createFragment, insertBoundary, type NodeFactory, type VobsNode } from '@vobs/vobs'
import type { Resource } from './resource'

export type ResourceBoundaryChild<T> = (data: T) => ReturnType<NodeFactory>
export type ResourceBoundaryView = ReturnType<NodeFactory> | NodeFactory
export type ResourceBoundaryFallback = (
  error: Error,
  retry: () => Promise<unknown>
) => ReturnType<NodeFactory>

export interface ResourceBoundaryOptions<T> {
  resource: Resource<T>
  children: ResourceBoundaryChild<T>
  loading?: ResourceBoundaryView
  empty?: ResourceBoundaryView
  fallback?: ResourceBoundaryFallback
}

export interface ResourceBoundaryProps<T> extends ResourceBoundaryOptions<T> {}

/**
 * Inserts a reactive Resource state branch. The compiler can lower a future
 * ResourceBoundary JSX element to this host-level instruction without a wrapper node.
 */
export function insertResourceBoundary<T>(
  parent: Node,
  anchor: Node | null,
  options: ResourceBoundaryOptions<T>
): void {
  insertBoundary(parent, anchor, {
    onRetry: () => options.resource.refetch(),
    fallback: (error, retry) => options.fallback?.(error, () => Promise.resolve(retry())) ?? null,
    children: () => {
      if (options.resource.error.value) throw options.resource.error.value
      if (options.resource.loading.value) return resolveView(options.loading)

      const data = options.resource.data.value
      if (data === null) return resolveView(options.empty)
      return options.children(data)
    }
  })
}

/** Component-shaped API backed by the same no-wrapper boundary instruction. */
export function ResourceBoundary<T>(props: ResourceBoundaryProps<T>): VobsNode {
  return createFragment((parent, anchor) => insertResourceBoundary(parent, anchor, props))
}

function resolveView(view: ResourceBoundaryView | undefined): ReturnType<NodeFactory> {
  if (!view) return null
  return typeof view === 'function' ? view() : view
}
