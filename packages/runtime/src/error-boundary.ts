import { createFragment, type VobsNode } from './fragment'
import { insertBoundary, type BoundaryRetry } from './boundary'
import type { NodeFactory } from './dynamic'

export type ErrorBoundaryFallback = (
  error: Error,
  retry: BoundaryRetry
) => ReturnType<NodeFactory>

export interface ErrorBoundaryOptions {
  children: NodeFactory
  fallback: ErrorBoundaryFallback
}

export interface ErrorBoundaryProps {
  children: NodeFactory
  fallback: ErrorBoundaryFallback
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
  insertBoundary(parent, anchor, options)
}

/** Component-shaped API backed by the same no-wrapper host instruction. */
export function ErrorBoundary(props: ErrorBoundaryProps): VobsNode {
  return createFragment((parent, anchor) => insertErrorBoundary(parent, anchor, props))
}
