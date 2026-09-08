import { getCurrentOwner, type Owner } from './owner'

const rootCounters = new WeakMap<Owner, number>()
let detachedCounter = 0

/**
 * Create an application-scoped identifier. Counters live on the current root
 * Owner, so concurrent SSR requests and multiple apps never share state.
 */
export function createId(prefix = 'vobs'): string {
  const owner = getCurrentOwner()
  let root = owner
  while (root?.parent) root = root.parent
  const counter = root
    ? (rootCounters.get(root) ?? 0) + 1
    : ++detachedCounter
  if (root) rootCounters.set(root, counter)
  const normalized = String(prefix).trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'vobs'
  return `${normalized}-${counter.toString(36)}`
}

/** Alias using the familiar composition-style naming. */
export const useId = createId
