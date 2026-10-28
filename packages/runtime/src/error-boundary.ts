import { createFragment, type VobsNode } from './fragment'
import { insertBoundary, type BoundaryRetry } from './boundary'
import type { NodeFactory } from './dynamic'

export type ErrorBoundaryFallback = (
  error: Error,
  retry: BoundaryRetry
) => ReturnType<NodeFactory>

/**
 * Two child shapes: JSX props are compiled by the compiler into lazy getters (factories),
 * while hand-written object literals may pass nodes directly.
 */
export type ErrorBoundaryChildren = NodeFactory | VobsNode

export interface ErrorBoundaryOptions {
  children: ErrorBoundaryChildren
  fallback: ErrorBoundaryFallback
}

export interface ErrorBoundaryProps {
  children: ErrorBoundaryChildren
  fallback: ErrorBoundaryFallback
}

/** Normalize child sources to the lazy factory shape insertBoundary expects. */
function resolveBoundaryChildren(children: ErrorBoundaryChildren): NodeFactory {
  return typeof children === 'function' ? children : () => children
}

/**
 * Inserts an error boundary without adding a wrapper node. It captures errors
 * from its child render branch and child-owned effects, then renders fallback.
 */
export function insertErrorBoundary(
  parent: Node,
  anchor: Node | null,
  options: ErrorBoundaryOptions
): void {
  insertBoundary(parent, anchor, { ...options, children: resolveBoundaryChildren(options.children) })
}

/** Component-shaped API backed by the same no-wrapper host instruction. */
export function ErrorBoundary(props: ErrorBoundaryProps): VobsNode {
  return createFragment((parent, anchor) => insertErrorBoundary(parent, anchor, props))
}
