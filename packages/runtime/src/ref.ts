import { getCurrentOwner, type Owner } from '@vobs/reactivity'
import { formatVobsError } from './error'

/** A mutable reference populated when a host node is mounted. */
export interface Ref<T extends object = Node> {
  current: T | null
}

export type RefTarget<T extends object = Node> = Ref<T> | ((value: T | null) => void)

export function ref<T extends object = Node>(initialValue: T | null = null): Ref<T> {
  return { current: initialValue }
}

/*
 * Keep only **one** cleanup registration per (Owner, ref target).
 *
 * Why: a `ref` may be bound to different nodes over time (same ref object, node replaced;
 * or a conditional branch swaps the host element). If every binding appended another
 * `onDispose` entry, disposal runs registrations in **reverse** order: the later entry
 * clears `target.current` to `null` first, so the earlier entry's guard
 * (`isObjectRef(target) && target.current !== node`) **happens to pass** and it clears
 * again — the final read sees `null` instead of the current node.
 *
 * A WeakMap<Owner, WeakMap<target, cleanup>> instead of attaching properties to the Owner:
 * Owner is a class instance, and adding properties pushes it into dictionary mode
 * (reactivity/src/owner.ts recorded that cost). target is weakly referenceable (object),
 * and function refs are objects too, so nothing blocks GC.
 */
const refCleanups = new WeakMap<Owner, WeakMap<object, () => void>>()

function rememberRefCleanup(owner: Owner, target: object, cleanup: () => void): void {
  let byTarget = refCleanups.get(owner)
  if (!byTarget) {
    byTarget = new WeakMap()
    refCleanups.set(owner, byTarget)
  }
  const previous = byTarget.get(target)
  if (previous) owner.removeCleanup(previous)
  byTarget.set(target, cleanup)
}

/** Bind a host node to an object or callback ref and clear it with its Owner. */
export function setRef<T extends object>(node: T, target: unknown): void {
  if (!isRefTarget<T>(target)) return
  // SSR's serializable nodes are never exposed as live refs. Custom renderers
  // may use arbitrary host objects, so only exclude the known SSR shape.
  if (isSSRNode(node)) return
  const owner = getCurrentOwner()
  assignRef(target, node)
  if (!owner) return
  const cleanup = (): void => {
    /*
     * When clearing a ref, exceptions **must be swallowed here** — a user ref callback
     * must not be allowed to break the dispose cascade.
     *
     * `assignRef` already does try/catch + `console.error` internally (the callback is user
     * code; mounting shouldn't fail over it), but that protection only covers the
     * "assign" step — there is also a **pre-check here that may throw**. Per React
     * semantics, a function ref **is supposed to receive `null`** on unmount; if the
     * callback doesn't null-check (e.g. `node => insertList(node, …)`), it throws, and an
     * exception bubbling out of onDispose **interrupts the Owner's entire cleanup loop**
     * (observed: `/runtime` page's `<ul ref={attachList}>`). This is the same class of
     * defect as the already-fixed "a child Owner throwing must not break the cascade"
     * in owner.ts.
     */
    try {
      // Do not clear a ref that has since been reassigned to another node.
      if (isObjectRef(target) && target.current !== node) return
      assignRef(target, null)
    } catch (error) {
      console.error(formatVobsError(error, { includeStack: true }))
    }
  }
  rememberRefCleanup(owner, target as object, cleanup)
  owner.onDispose(cleanup)
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
  } catch (error) {
    /*
     * A ref callback is user code; mounting must not fail over it — but it also can't be
     * **completely silent**: when the callback throws, the ref never gets the node, the UI
     * looks fine, and the user has no idea why. Keep swallowing (no bubbling), but leave a
     * console record.
     */
    console.error(formatVobsError(error, { includeStack: true }))
  }
}
