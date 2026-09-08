import { getCurrentOwner } from '@vobs/reactivity'

/** A mutable reference populated when a host node is mounted. */
export interface Ref<T extends object = Node> {
  current: T | null
}

export type RefTarget<T extends object = Node> = Ref<T> | ((value: T | null) => void)

export function ref<T extends object = Node>(initialValue: T | null = null): Ref<T> {
  return { current: initialValue }
}

/** Bind a host node to an object or callback ref and clear it with its Owner. */
export function setRef<T extends object>(node: T, target: unknown): void {
  if (!isRefTarget<T>(target)) return
  // SSR's serializable nodes are never exposed as live refs. Custom renderers
  // may use arbitrary host objects, so only exclude the known SSR shape.
  if (isSSRNode(node)) return
  const owner = getCurrentOwner()
  assignRef(target, node)
  owner?.onDispose(() => {
    // Do not clear a ref that has since been reassigned to another node.
    if (isObjectRef(target) && target.current !== node) return
    assignRef(target, null)
  })
}

function isSSRNode(value: object): boolean {
  const type = (value as { type?: unknown }).type
  return (type === 'element' || type === 'text' || type === 'comment')
    && !('nodeType' in value)
}

function isObjectRef<T extends object>(value: unknown): value is Ref<T> {
  return Boolean(value && typeof value === 'object' && 'current' in value)
}

function isRefTarget<T extends object>(value: unknown): value is RefTarget<T> {
  return isObjectRef<T>(value) || typeof value === 'function'
}

function assignRef<T extends object>(target: RefTarget<T>, value: T | null): void {
  try {
    if (typeof target === 'function') target(value)
    else target.current = value
  } catch {
    // Ref callbacks are user code; never make mounting fail because of them.
  }
}
