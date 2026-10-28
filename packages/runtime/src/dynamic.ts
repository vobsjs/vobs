import { createOwner, effect, state, type Owner, type Signal } from '@vobs/reactivity'
import {
  associateNodeOwner,
  createBlock,
  createComment,
  createText,
  insertBefore,
  removeChild,
  setTextContent
} from './ops'
import { createFragment, isVobsFragment, type VobsNode } from './fragment'

export type NodeFactory = () => VobsNode | null | undefined | false
export type DynamicChild = VobsNode | string | number | boolean | null | undefined | readonly DynamicChild[]

interface ListEntry<T> {
  key: unknown
  node: VobsNode
  owner: Owner
  viewOwner: Owner
  item: Signal<T>
  /** The raw item last assigned: used for comparison and refresh, avoiding reads of the item signal inside the list effect creating a self-dependency.
   *  (Deliberately not named value — `vobs check`'s VOBS_C210 treats reads/writes of `X.value` as signal self-subscription.) */
  current: T
  index: number
}

export function insertDynamic(parent: Node, anchor: Node | null, factory: NodeFactory): void {
  const marker = createComment('vobs:dynamic')
  insertBefore(parent, marker, anchor)
  let current: VobsNode | null = null

  effect(() => {
    const next = createBlock(factory)
    if (next === current) return

    if (current) removeChild(parent, current)
    current = next
    if (current) insertBefore(parent, current, marker)
  })
}

/**
 * Inserts any Vobs child value. This is the escape hatch for JSX expressions
 * that return a node, an array of nodes, text, or an empty conditional value.
 *
 * Polymorphic insertion (Solid-style): the compiler routes all non-static child expressions
 * here uniformly, and the value type is dispatched at runtime — primitives take the
 * in-place-update fast path with a self-managed text node (equivalent to bindText
 * performance), while nodes/Fragments/arrays take the scope-isolated mount/unmount path.
 * A function call returning a node is therefore just as safe as returning a string.
 */
export function insertDynamicValue(
  parent: Node,
  anchor: Node | null,
  factory: () => DynamicChild
): void {
  const marker = createComment('vobs:value')
  insertBefore(parent, marker, anchor)
  let current: VobsNode | null = null
  /** Whether `current` is a text node created by this effect (safe to rewrite content in place) */
  let currentIsText = false
  let scope: Owner | null = null

  effect(() => {
    // Each evaluation round uses an independent scope Owner: component Owners created during
    // factory evaluation and mounting are all attached under it.
    // When an array/node is replaced, the old scope is disposed wholesale, preventing effects
    // of the discarded subtree from staying subscribed to signals (ghost updates and memory leaks).
    const nextScope = createOwner()
    const value = nextScope.run(factory)
    // ── Primitive fast path: rewrite the self-created text node in place, no destroy/rebuild (zero GC for high-frequency text) ──
    if (typeof value === 'string' || typeof value === 'number') {
      if (currentIsText) {
        setTextContent(current as Text, String(value))
        nextScope.dispose()
        return
      }
      if (current) removeChild(parent, current)
      scope?.dispose()
      scope = null
      const text = createText(String(value))
      insertBefore(parent, text, marker)
      current = text
      currentIsText = true
      nextScope.dispose()
      return
    }
    if (value === null || value === undefined || typeof value === 'boolean') {
      if (current) removeChild(parent, current)
      scope?.dispose()
      scope = null
      current = null
      currentIsText = false
      nextScope.dispose()
      return
    }
    // ── Node/Fragment/array path: scope-isolated mount and wholesale replacement ──
    const next = nextScope.run(() => normalizeDynamicChild(value))
    if (next === current) {
      nextScope.dispose()
      return
    }
    if (current) removeChild(parent, current)
    scope?.dispose()
    scope = nextScope
    current = next
    currentIsText = false
    if (current) insertBefore(parent, current, marker)
  })
}

/** Convert a JSX child value to a host node without creating a wrapper element. */
export function normalizeDynamicChild(value: DynamicChild): VobsNode | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value === 'string' || typeof value === 'number') return createText(String(value))
  if (isVobsFragment(value) || isHostNode(value)) return value as VobsNode
  if (Array.isArray(value)) {
    const children = value
    if (children.length === 0) return null
    return createFragment((parent, anchor) => {
      for (const child of children) {
        const node = normalizeDynamicChild(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return null
}

function isHostNode(value: unknown): value is Node {
  return Boolean(value && typeof value === 'object'
    && ('nodeType' in value || ((value as { type?: unknown }).type === 'element'
      || (value as { type?: unknown }).type === 'text'
      || (value as { type?: unknown }).type === 'comment')))
}

export function insertList<T>(
  parent: Node,
  anchor: Node | null,
  source: () => readonly T[],
  renderItem: (item: T, index: number) => VobsNode,
  keyOf?: (item: T, index: number) => unknown
): void {
  const marker = createComment('vobs:list')
  insertBefore(parent, marker, anchor)
  let entries: Array<ListEntry<T>> = []
  const tracksIndex = renderItem.length >= 2

  effect(() => {
    const items = source()

    // Keys are computed once: shared by the keyed decision and reconciliation, so keyOf
    // isn't called twice per round.
    let keys: unknown[] | null = null
    if (keyOf) {
      keys = new Array(items.length)
      let allKeyed = items.length > 0
      for (let index = 0; index < items.length; index++) {
        const key = keyOf(items[index], index)
        if (key == null) {
          allKeyed = false
          break
        }
        keys[index] = key
      }
      if (!allKeyed) keys = null
    }

    /*
     * Fast path: the key sequence is **bit-for-bit identical** to the previous round —
     * not one row more, not one less, order unchanged.
     *
     * The DOM is already in the correct order (the reorder at the end of every update
     * guarantees "DOM order === entries order"), so building the table (Map), dedup
     * (Set), set difference (retained Set) and reordering (seq array + LIS) are **all
     * unnecessary** — only each row's item and index need syncing. This bookkeeping is
     * per-row: the fixed cost for 200 rows measured ~34µs, while the only DOM writes
     * actually needed this round are 0.2µs (see scripts/bench).
     *
     * The scan itself is O(n) with two comparisons per row (key + needs-rebuild), an
     * order of magnitude cheaper than the bookkeeping it saves. If any row needs a
     * rebuild (a primitive item's value changed — that row's view was statically
     * captured), fall back to the regular path.
     */
    if (keys !== null && entries.length === items.length) {
      let fast = true
      for (let index = 0; index < keys.length; index++) {
        if (!Object.is(entries[index].key, keys[index])) {
          fast = false
          break
        }
        const item = items[index]
        if (isPrimitiveItem(item) && !Object.is(entries[index].current, item)) {
          fast = false
          break
        }
      }
      if (fast) {
        for (let index = 0; index < items.length; index++) {
          const entry = entries[index]
          entry.index = index
          const item = items[index]
          if (!Object.is(entry.current, item)) {
            // Signal writes are short-circuited by Object.is when the value is unchanged, so only touch rows that really changed
            entry.item.value = item
            entry.current = item
          }
        }
        return
      }
    }

    const nextEntries = keys
      ? reconcileKeyed(items, keys, entries, renderItem)
      : reconcileIndexed(items, entries, renderItem)

    // When tracksIndex, index participates in rendering, so rows whose position changed must
    // be rebuilt wholesale — their new nodes aren't in the DOM yet and the reorder phase
    // force-inserts them; otherwise only the recorded position is synced and the node is
    // left in place for the reorder phase to move.
    const refreshed = tracksIndex ? new Set<ListEntry<T>>() : null
    for (let index = 0; index < nextEntries.length; index++) {
      const entry = nextEntries[index]
      if (tracksIndex) {
        if (entry.index !== index) {
          refreshListEntry(parent, entry, index, renderItem)
          refreshed!.add(entry)
        }
      } else {
        entry.index = index
      }
    }

    const retained = new Set(nextEntries)
    for (const entry of entries) {
      if (!retained.has(entry)) disposeEntry(parent, entry)
    }

    reorderListEntries(parent, marker, entries, nextEntries, refreshed)
    entries = nextEntries
  })
}

/**
 * Reorder the DOM to match nextEntries, but only move the nodes that must move.
 */
function reorderListEntries<T>(
  parent: Node,
  marker: Node,
  previous: readonly ListEntry<T>[],
  nextEntries: readonly ListEntry<T>[],
  forceInsert: Set<ListEntry<T>> | null
): void {
  const count = nextEntries.length
  if (count === 0) return

  // First mount (previous list empty): everything is a new node, so a reverse-order direct
  // insert suffices; skip Map/LIS construction.
  if (previous.length === 0) {
    let reference: VobsNode = marker
    for (let index = count - 1; index >= 0; index--) {
      const node = nextEntries[index].node
      insertBefore(parent, node, reference)
      reference = node
    }
    return
  }

  const oldIndexOf = new Map<ListEntry<T>, number>()
  for (let index = 0; index < previous.length; index++) oldIndexOf.set(previous[index], index)

  // seq[i] = the entry's position in the old order; new, rebuilt and force-inserted entries are -1.
  const seq: number[] = new Array(count)
  for (let index = 0; index < count; index++) {
    const entry = nextEntries[index]
    seq[index] = forceInsert?.has(entry) ? -1 : oldIndexOf.get(entry) ?? -1
  }

  const keep = computeKeptByLis(seq)

  let reference: VobsNode = marker
  for (let index = count - 1; index >= 0; index--) {
    const node = nextEntries[index].node
    if (keep[index]) {
      reference = node
      continue
    }
    insertBefore(parent, node, reference)
    reference = node
  }
}

/**
 * Strictly increasing subsequence (LIS) membership marks, O(n log n).
 * Negative values (new nodes) don't participate in the LIS and are always treated as
 * needing to move.
 */
function computeKeptByLis(seq: readonly number[]): boolean[] {
  const count = seq.length
  const keep = new Array<boolean>(count).fill(false)
  const tailsIndex: number[] = []
  const tailsValue: number[] = []
  const prev = new Array<number>(count).fill(-1)

  for (let i = 0; i < count; i++) {
    const value = seq[i]
    if (value < 0) continue
    let lo = 0
    let hi = tailsValue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tailsValue[mid] < value) lo = mid + 1
      else hi = mid
    }
    if (lo === tailsValue.length) {
      tailsValue.push(value)
      tailsIndex.push(i)
    } else {
      tailsValue[lo] = value
      tailsIndex[lo] = i
    }
    prev[i] = lo > 0 ? tailsIndex[lo - 1] : -1
  }

  let cursor = tailsIndex.length > 0 ? tailsIndex[tailsIndex.length - 1] : -1
  while (cursor >= 0) {
    keep[cursor] = true
    cursor = prev[cursor]
  }
  return keep
}

function reconcileKeyed<T>(
  items: readonly T[],
  keys: readonly unknown[],
  entries: Array<ListEntry<T>>,
  renderItem: (item: T, index: number) => VobsNode
): Array<ListEntry<T>> {
  // Build the table entry by entry instead of entries.map(...): the latter first allocates
  // an equal-length "array of [key, value] pairs" as an intermediate artifact — for 200 rows
  // that's 200 tuple object allocations paid for nothing on every update.
  const previous = new Map<unknown, ListEntry<T>>()
  for (const entry of entries) previous.set(entry.key, entry)
  const seen = new Set<unknown>()
  const nextEntries: Array<ListEntry<T>> = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const key = keys[index]
    if (seen.has(key)) {
      console.warn(`Vobs: duplicate list key detected: ${String(key)}`)
    }
    seen.add(key)
    const entry = previous.get(key)
    if (entry) {
      previous.delete(key)
      if (isPrimitiveItem(item) && !Object.is(entry.current, item)) {
        // Primitive items are statically captured in the compiled output, so the view can't
        // be refreshed via the item signal: the row must be rebuilt when the value changes.
        nextEntries.push(createListEntry(item, index, key, renderItem))
        continue
      }
      entry.item.value = item
      entry.current = item
      nextEntries.push(entry)
      continue
    }
    nextEntries.push(createListEntry(item, index, key, renderItem))
  }

  return nextEntries
}

function reconcileIndexed<T>(
  items: readonly T[],
  entries: Array<ListEntry<T>>,
  renderItem: (item: T, index: number) => VobsNode
): Array<ListEntry<T>> {
  const nextEntries: Array<ListEntry<T>> = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const entry = entries[index]
    if (entry && isPrimitiveItem(item) && !Object.is(entry.current, item)) {
      // Primitive items are statically captured in the compiled output; the row must be
      // rebuilt when the value changes. Old rows are disposed by the main loop.
      nextEntries.push(createListEntry(item, index, index, renderItem))
      continue
    }
    if (entry) {
      entry.item.value = item
      entry.current = item
      nextEntries.push(entry)
      continue
    }
    nextEntries.push(createListEntry(item, index, index, renderItem))
  }
  return nextEntries
}

/** Primitives (including functions) can't be made reactive via a Proxy; only a whole-row rebuild works. */
function isPrimitiveItem(item: unknown): boolean {
  return item === null || typeof item !== 'object'
}

function createListEntry<T>(
  item: T,
  index: number,
  key: unknown,
  renderItem: (item: T, index: number) => VobsNode
): ListEntry<T> {
  const owner = createOwner()
  let itemSignal!: Signal<T>
  let viewOwner!: Owner
  let node!: VobsNode
  owner.run(() => {
    itemSignal = state(item, 'signal')
    viewOwner = createOwner()
    node = viewOwner.run(() => renderItem(toReactiveItem(itemSignal, item), index))
  })
  associateNodeOwner(node, viewOwner)
  return { key, node, owner, viewOwner, item: itemSignal, current: item, index }
}

function refreshListEntry<T>(
  parent: Node,
  entry: ListEntry<T>,
  index: number,
  renderItem: (item: T, index: number) => VobsNode
): void {
  removeChild(parent, entry.node)
  entry.index = index
  const previousView = entry.viewOwner
  entry.owner.run(() => {
    entry.viewOwner = createOwner()
    entry.node = entry.viewOwner.run(() => renderItem(
      toReactiveItem(entry.item, entry.current),
      index
    ))
  })
  // The old view's effect still subscribes to the item signal; it must be disposed, or it
  // would write to detached DOM (ghost updates).
  previousView.dispose()
  associateNodeOwner(entry.node, entry.viewOwner)
}

function toReactiveItem<T>(item: Signal<T>, initialValue: T): T {
  if (typeof initialValue !== 'object' || initialValue === null) {
    return initialValue
  }

  // Property reads are forwarded to item.value (the new entry after same-key replacement);
  // the get trap does the tracking. See reactiveProxyTarget for the target.
  return new Proxy(reactiveProxyTarget(initialValue), {
    get(_target, property, receiver) {
      return Reflect.get(item.value as object, property, receiver)
    },
    has(_target, property) {
      return property in (item.value as object)
    },
    ownKeys() {
      return Reflect.ownKeys(item.value as object)
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(item.value as object, property)
      if (!descriptor) return undefined
      // Existing own properties on the target must not be misreported as "configurable"
      // (an array's length is non-configurable), or the proxy invariant is violated
      const own = Object.getOwnPropertyDescriptor(target, property)
      return { ...descriptor, configurable: own ? own.configurable : true }
    }
  }) as T
}

/**
 * Choose the proxy target.
 *
 * The target **must not** carry non-configurable own properties: the proxy forwards
 * property reads to `item.value` (the new entry after same-key replacement), and Proxy
 * invariants require get / getOwnPropertyDescriptor / ownKeys to agree with the target.
 * Measured: a frozen entry (@vobs/notification freezes every notification) throws outright:
 *
 *   TypeError: 'get' on proxy: property 'content' is a read-only and non-configurable data
 *   property on the proxy target but the proxy did not return its actual value
 *
 * So "in-place refresh of a frozen entry's row" is fundamentally impossible as a path
 * (the first render happens to have the same value, masking the problem).
 *
 * Safe entries (extensible + all own properties configurable: plain literals, DOM
 * wrappers etc.) keep using the entry itself as the target — jsdom writes Symbol caches
 * like sameObjectCaches onto the wrapper, so writes and reads must land on the same
 * object; swapping the target would make `element.classList` throw a TypeError outright.
 * Frozen/sealed/defineProperty'd entries switch to an empty object of the same prototype
 * (arrays use an empty array, preserving Array.isArray).
 */
function reactiveProxyTarget(value: object): object {
  if (Object.isExtensible(value)) {
    let allConfigurable = true
    for (const key of Reflect.ownKeys(value)) {
      if (Object.getOwnPropertyDescriptor(value, key)?.configurable === false) {
        allConfigurable = false
        break
      }
    }
    if (allConfigurable) return value
  }
  return Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value) as object | null)
}

function disposeEntry(parent: Node, entry: ListEntry<unknown>): void {
  removeChild(parent, entry.node)
  entry.owner.dispose()
}

/**
 * Conditional container + mount inside it (the dedicated compiled artifact for "keyed
 * lists inside ternary/`&&` branches", the C232 cure).
 *
 * `{cond ? items.map(...) : null}` goes through polymorphic insertion, where an array
 * value has no identity (every factory evaluation creates brand-new nodes) and the
 * runtime has nothing to reuse — a change of either cond or items rebuilds the whole
 * list. This instruction splits **condition** and **list** into two subscription layers:
 * cond only manages the container's mount/unmount; inside the container the list goes
 * through the standard `insertList`, reusing/moving by key, so cond jitter no longer
 * touches the list.
 *
 * Implementation note: the container **cannot be a comment node** (per the DOM spec a
 * Comment can't have children, insertBefore throws HierarchyRequestError) — a pair of
 * comment marks brackets the row region, and the container that mount receives is a
 * lightweight proxy forwarding inserts to parent (anchored at endMark); unmount = delete
 * the nodes between the marks + dispose the container scope (list rows and their effects
 * destroyed together). Division of labor with `Show` (hidden/inert keeps mounted): this
 * one has true "unmount" semantics.
 */
export function insertShow(
  parent: Node,
  anchor: Node | null,
  condition: () => unknown,
  mount: (container: Node) => void
): void {
  const startMark = createComment('vobs:show')
  const endMark = createComment('vobs:show-end')
  insertBefore(parent, startMark, anchor)
  insertBefore(parent, endMark, anchor)
  const container = createShowContainer(parent, endMark)
  let mounted = false
  let scope: Owner | null = null

  effect(() => {
    const visible = Boolean(condition())
    if (visible) {
      if (mounted) return
      mounted = true
      scope = createOwner()
      scope.run(() => mount(container))
      return
    }
    if (mounted) {
      mounted = false
      let node = startMark.nextSibling
      while (node !== null && node !== endMark) {
        const next = node.nextSibling
        removeChild(parent, node)
        node = next
      }
      scope?.dispose()
      scope = null
    }
  })
}

/**
 * Container proxy for insertShow: implements only the operations the insertList family
 * actually touches (insertBefore / removeChild / appendChild), with all inserts anchored
 * at endMark — while still presenting as a Node externally (mount's type is
 * (container: Node) => void).
 */
function createShowContainer(parent: Node, endMark: Node): Node {
  const container = {
    nodeType: 1,
    insertBefore(node: Node, reference: Node | null): Node {
      parent.insertBefore(node, reference ?? endMark)
      return node
    },
    removeChild(node: Node): Node {
      parent.removeChild(node)
      return node
    },
    appendChild(node: Node): Node {
      parent.insertBefore(node, endMark)
      return node
    }
  }
  return container as unknown as Node
}
