// Base operations called by compiled output

import { createOwner, effect, getCurrentOwner, setOwnerDebugName, untrack, type Owner } from '@vobs/reactivity'
import { isVobsFragment, type VobsNode } from './fragment'
import { domAttributeName, isPropertyName } from './dom-props'
import { resolveEventName } from './dom-events'
import { isSvgTag } from './svg'
import { formatVobsError } from './error'
import { describeDebugNode, getRuntimeDebugHooks, invokeRuntimeDebug, readDebugValue } from './debug'
import {
  associateHmrInstance,
  markHmrInstanceMounted,
  registerHmrInstance,
  type HmrInstance
} from './hmr'
import type { VobsRenderer } from './renderer'
import { setRef } from './ref'

type RuntimeRenderer = VobsRenderer<Node, Text, Element, Comment>

let currentRenderer: RuntimeRenderer | null = null
const nodeOwners = new WeakMap<object, Owner>()
interface EventBinding {
  readonly handler: EventListener
  readonly owner: Owner | null
  readonly original: EventListener
}
const eventBindings = new WeakMap<object, Map<string, EventBinding>>()

/*
 * Event cleanup slots. Purpose: make **each (Owner, node, event) occupy exactly one slot
 * in `Owner.cleanups`** — rebinding a handler only swaps the indirect reference inside the
 * slot, the array never grows (rationale in addEventListener).
 *
 * A WeakMap<Owner, Map<key, handle>> instead of attaching properties to the Owner:
 * Owner is a class instance, and adding properties pushes it into dictionary mode
 * (the cost was recorded in reactivity/src/owner.ts:30-50). The key is composed from a
 * per-node numeric id and the event name, avoiding long string prefix comparisons on
 * every rebind.
 */
const eventCleanupSlots = new WeakMap<Owner, Map<string, EventBinding>>()
const eventCleanupNodeIds = new WeakMap<object, number>()
let nextEventCleanupNodeId = 0

function eventCleanupKey(node: object, event: string): string {
  let id = eventCleanupNodeIds.get(node)
  if (id === undefined) {
    id = ++nextEventCleanupNodeId
    eventCleanupNodeIds.set(node, id)
  }
  return `${id}:${event}`
}

export function setRenderer<
  NodeType,
  TextNode extends NodeType,
  ElementNode extends NodeType,
  CommentNode extends NodeType
>(
  renderer: VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined
): VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined {
  // Returns the **previous** renderer (undefined if none), so callers can pair
  // "install / restore". The global singleton used to install-only: after one
  // renderToString it stayed on the SSR renderer forever (see vobs/src/app.ts).
  const previous = currentRenderer as unknown as
    VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined
  // Compiled output still declares DOM nodes; the actual host type is decided by the
  // renderer the application provides.
  currentRenderer = (renderer as unknown as RuntimeRenderer) ?? null
  return previous
}

export function getRenderer(): RuntimeRenderer {
  if (!currentRenderer) {
    throw new Error('Renderer not initialized')
  }
  return currentRenderer
}

export function createText(content: string): Text {
  return getRenderer().createText(content)
}

/** For the SVG namespace and tag list see ./svg — the same source of truth used for compile-time hoisting decisions. */
export { SVG_NAMESPACE } from './svg'

export function createElement(tag: string): Element {
  // SVG tags are created in the namespace: document.createElement('rect') yields an
  // HTMLUnknownElement and the whole SVG subtree fails to render (no error). When the
  // renderer hasn't implemented createSvgElement, fall back to createElement (old custom
  // renderers keep their original behavior).
  if (isSvgTag(tag)) {
    const renderer = getRenderer()
    if (renderer.createSvgElement) return renderer.createSvgElement(tag)
  }
  return getRenderer().createElement(tag)
}

/**
 * Create an element in the SVG namespace, **regardless of tag name**.
 *
 * For the compiler to use on tags homonymous with HTML (a / title / style / script)
 * under an `<svg>` ancestor — they are not in SVG_TAGS, so `createElement` would build
 * them as HTML. Deciding the namespace by name alone doesn't work:
 * `<svg><a href="…">` would become an HTML anchor, with no error.
 *
 * When the renderer hasn't implemented createSvgElement, fall back to createElement
 * (custom renderers keep their original behavior).
 */
export function createSvgElement(tag: string): Element {
  const renderer = getRenderer()
  if (renderer.createSvgElement) return renderer.createSvgElement(tag)
  return renderer.createElement(tag)
}

export function createComment(content: string): Comment {
  return getRenderer().createComment(content)
}

export function insertBefore(
  parent: Node,
  child: VobsNode,
  anchor: VobsNode | null
): void {
  if (isVobsFragment(child)) {
    child.mount(parent, isVobsFragment(anchor) ? anchor.start : anchor)
    markHmrInstanceMounted(child, parent)
    return
  }
  getRenderer().insertBefore(parent, child, isVobsFragment(anchor) ? anchor.start : anchor)
  markHmrInstanceMounted(child, parent)
  const nodeName = (child as Element).nodeName
  if (nodeName === 'OPTION' || nodeName === 'OPTGROUP') syncSelectValue(parent)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'insert',
      target: describeDebugNode(child),
      parent: describeDebugNode(parent)
    })
  }
}

/**
 * Select initial-value auto resync: `bindProperty(node, 'value', …)` registers the value
 * reader for `<select>` elements; whenever an `<option>` is inserted into the select
 * (directly or through an `<optgroup>`), the current bound value is re-applied. This
 * removes the last reason for apps to keep `ref + queueMicrotask` value-sync workarounds
 * for options that arrive after the value binding (e.g. asynchronously loaded lists).
 */
const selectValueReaders = new WeakMap<object, () => unknown>()

export function registerSelectValueBinding(select: Element, read: () => unknown): void {
  selectValueReaders.set(select, read)
}

function syncSelectValue(parent: Node): void {
  let current: Node | null = parent
  while (current !== null) {
    if ((current as Element).nodeName === 'SELECT') {
      const read = selectValueReaders.get(current)
      /*
       * The read must be `untrack`ed — here we synchronously **replay** the current value
       * in the middle of inserting an option, and insertion usually happens while some
       * effect is running (both `insertList` and `insertDynamic` are effect-driven).
       * If that read were counted into the outer effect's dependencies, the effect would
       * from then on be woken by this signal: a **hidden subscription** — one extra edge
       * in the dependency graph nobody intended, showing up as "inserting an option
       * happens to re-run some unrelated effect", very hard to trace.
       *
       * This binding's subscription belongs to `bindProperty`'s own effect (bind.ts);
       * the replay here merely writes the value **once more** — it neither needs nor
       * should establish a dependency.
       */
      if (read !== undefined) setProperty(current as Element, 'value', untrack(read))
      return
    }
    current = current.parentNode
  }
}

export function removeChild(
  parent: Node,
  child: VobsNode
): void {
  /*
   * **Detach the DOM first, then release the Owner.**
   *
   * It used to be the other way around: if `disposeNodeOwner(child)` threw (a user
   * cleanup throwing), the detach step was never reached — the DOM kept the old node
   * while its effects were already gone, leaving two trees on screen with no hint.
   * With the order flipped, the DOM stays consistent even when cleanup throws; the
   * error is still thrown to the caller as before.
   */
  if (isVobsFragment(child)) {
    child.unmount(parent)
    disposeNodeOwner(child)
    return
  }
  getRenderer().removeChild(parent, child)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'remove',
      target: describeDebugNode(child),
      parent: describeDebugNode(parent)
    })
  }
  disposeNodeOwner(child)
}

export function setTextContent(
  node: Text,
  content: string
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => node.textContent)
    : undefined
  getRenderer().setTextContent(node, content)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'text',
      target: describeDebugNode(node),
      previousValue,
      nextValue: content
    })
  }
}

export function setProperty(
  node: Element,
  key: string,
  value: unknown
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => Reflect.get(node, key))
    : undefined
  getRenderer().setProperty(node, PROPERTY_IDL_NAMES[key] ?? key, value)
  if (key === 'value' && (node as { tagName?: unknown }).tagName === 'SELECT') {
    scheduleSelectValueSync(node, value)
  }
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'property',
      target: describeDebugNode(node),
      key,
      previousValue,
      nextValue: value
    })
  }
}

const pendingSelectValues = new WeakMap<Element, unknown>()
const selectSyncScheduled = new WeakSet<Element>()

/**
 * Assigning `<select value>` has no effect before option children exist (HTML spec: the
 * select's value is determined by the options already present). Compiled output sets the
 * property first and inserts children afterwards, so the static form inevitably loses the
 * initial value. Here, value assignments on a select are uniformly deferred and replayed
 * once in a microtask: static children are all inserted within the same synchronous task,
 * so the replay hits. Options inserted dynamically (insertList/insertDynamic) arrive after
 * that microtask; the value binding effect then overrides them normally on later signal
 * updates.
 */
function scheduleSelectValueSync(node: Element, value: unknown): void {
  pendingSelectValues.set(node, value)
  if (selectSyncScheduled.has(node)) return
  selectSyncScheduled.add(node)
  /*
   * Capture the renderer **right now** — do **not** call getRenderer() again inside the
   * microtask:
   * 1) Application teardown restores the global renderer (or "none" if never installed);
   *    a getRenderer() inside the microtask would then throw "Renderer not initialized" —
   *    thrown inside a microtask nobody catches, it becomes a process-level unhandled
   *    error (measured: `packages/ui/src/bind.test.ts` got 1 unhandled error in vitest
   *    and a non-zero exit code because of exactly this);
   * 2) It's also more correct semantically: whichever renderer created the node writes
   *    it back (the global one may have been swapped in the meantime).
   */
  const renderer = getRenderer()
  queueMicrotask(() => {
    selectSyncScheduled.delete(node)
    if (!pendingSelectValues.has(node)) return
    const pending = pendingSelectValues.get(node)
    pendingSelectValues.delete(node)
    renderer.setProperty(node, 'value', pending)
  })
}

export function setAttribute(
  node: Element,
  key: string,
  value: string
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => typeof node.getAttribute === 'function' ? node.getAttribute(key) : undefined)
    : undefined
  getRenderer().setAttribute(node, key, value)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'attribute',
      target: describeDebugNode(node),
      key,
      previousValue,
      nextValue: value
    })
  }
}

export function spreadProps(node: Element, props: Record<string, unknown>): void {
  applySpreadProps(node, null, props)
}

/** Remove one attribute. When the renderer hasn't implemented it, fall back to an empty string (the attribute remains, content cleared) — the downgrade behavior for old custom renderers. */
export function removeAttribute(node: Element, key: string): void {
  const renderer = getRenderer()
  if (renderer.removeAttribute) {
    renderer.removeAttribute(node, key)
    return
  }
  renderer.setAttribute(node, key, '')
}

/** The "clearing" value for boolean properties is false; for the rest it's an empty string (matching React's removal semantics). */
const BOOLEAN_PROPERTIES = new Set([
  'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required',
  'hidden', 'open', 'indeterminate', 'defaultChecked', 'muted', 'autoFocus'
])

/**
 * JSX prop name → **IDL property name** (the name in `el[name] = value`).
 *
 * Most names are identical on both sides, but a few differ; the consequence of the wrong
 * name is **silent**: `Reflect.set(el, 'autoFocus', …)` only hangs a non-reflecting
 * expando on the element — it produces neither the `autofocus` attribute nor a change to
 * the IDL property — so `autoFocus={false}` does nothing at all. Measured (jsdom, same
 * semantics as real DOM):
 *   IDL name `autofocus` (all lowercase) → has=true/idl=true, writing false gives has=false/idl=false ← reflection correct
 *   JSX name `autoFocus` (camelCase)     → only an expando; attribute and IDL unchanged
 * This also explains why `disabled` / `checked` / `readOnly` / `tabIndex` always worked:
 * their IDL names happen to equal their JSX names.
 */
const PROPERTY_IDL_NAMES: Readonly<Record<string, string>> = {
  autoFocus: 'autofocus'
}

/**
 * Apply (or **incrementally** apply) a props object onto a node.
 *
 * `previous === null` means first application (the old `spreadProps` path); otherwise
 * only keys that really changed are processed, and keys that disappeared from the new
 * object are **removed** — exactly the half that was missing: `{...props}` used to apply
 * only once at creation, so keys deleted from the object afterwards stayed on the DOM
 * forever, and changed values never took effect either.
 */
function applySpreadProps(
  node: Element,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(next)) {
    if (key === 'key') continue
    if (previous !== null && Object.is(previous[key], value)) continue

    if (key.startsWith('on')) {
      // Events: detach the old listener first (value changed, or the new value isn't a
      // function), then attach the new one.
      // The event name must go through the alias table: `onDoubleClick`'s real event
      // name is `dblclick`; naive lowercasing yields the nonexistent `"doubleclick"`
      // (the callback never fires, silently).
      const eventName = resolveEventName(key) ?? key.slice(2).toLowerCase()
      const previousHandler = previous?.[key]
      if (typeof previousHandler === 'function') {
        removeEventListener(node, eventName, previousHandler as EventListener)
      }
      if (typeof value === 'function') {
        addEventListener(node, eventName, value as EventListener)
      }
      continue
    }
    if (key === 'ref') {
      setRef(node, value)
      continue
    }
    // null/undefined mean "no value provided", **keep the status quo** (props.test.ts
    // pins this as a contract).
    // Note one known consequence: while the key is still in `next`, the removal loop
    // can't reach it (`key in next`), so "value changed to null midway" doesn't clear
    // an existing attribute — to clear it, the key must be deleted from the object.
    if (value === null || value === undefined) continue
    // false on property keys is semantic (e.g. disabled={false} must clear) and can't be
    // skipped; false on attribute keys means "don't set", consistent with HTML semantics.
    else if (isClassListKey(key)) applyClassList(node, value)
    else if (isPropertyName(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, domAttributeName(key), key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }

  if (previous === null) return
  for (const key of Object.keys(previous)) {
    if (key in next || key === 'key') continue
    if (key.startsWith('on')) {
      const eventName = resolveEventName(key) ?? key.slice(2).toLowerCase()
      const previousHandler = previous[key]
      if (typeof previousHandler === 'function') {
        removeEventListener(node, eventName, previousHandler as EventListener)
      }
      continue
    }
    if (key === 'ref') continue
    if (isPropertyName(key)) setProperty(node, key, BOOLEAN_PROPERTIES.has(key) ? false : '')
    else removeAttribute(node, domAttributeName(key))
  }
}

/**
 * Bind `{...props}` **reactively**: when the object changes, apply the diff; vanished
 * keys are removed.
 *
 * The compiler emits this (not `spreadProps`) for JSX elements carrying a spread — the
 * latter applies only once at creation, so "changed props don't take effect" and "deleted
 * keys linger on the DOM" both fail **without any error**.
 *
 * ⚠️ `previous` must be a **snapshot of the values**, not a reference to `next`.
 * When a reference is stored here, the next round's `Object.is(previous[key], value)` in
 * `applySpreadProps` reads the same values → always equal → **the entire diff
 * short-circuits**, and the removal loop is skipped wholesale by `key in next`.
 * And the shape the compiler emits for `<div {...props}>` is precisely
 * **identity-stable + getter** (`bindSpreadProps(_el0, () => props)`, values evaluated
 * reactively through the getter), so with real compiled output "changing props updates
 * nothing at all".
 *
 * A shallow copy suffices for the snapshot, and it **must be taken before applying**:
 * the copy evaluates each getter once and turns them into data properties, while
 * `applySpreadProps` also reads every key of `next` — both happen inside the effect's
 * tracking window, so signal dependencies are not lost by the extra pass.
 */
/**
 * The class names `classList` contributed last time (bookkept per element so the next
 * call replaces instead of stacking).
 *
 * Why bookkeep: `classList` and `class` write the **same** HTML attribute. Without
 * remembering which names the last `classList` call contributed, toggling either
 * accumulates more and more, or wipes the author's own `class`.
 */
const classListContributions = new WeakMap<object, string[]>()

/** `classList` value → class name array. Supports object / array / string forms. */
export function parseClassList(value: unknown): string[] {
  const names: string[] = []
  const push = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      for (const name of candidate.split(/\s+/u)) if (name !== '') names.push(name)
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object') {
        for (const [name, on] of Object.entries(entry)) if (on) push(name)
      } else push(entry)
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [name, on] of Object.entries(value)) if (on) push(name)
  } else push(value)
  return names
}

/**
 * Apply `classList`: **merged** with the `class` already on the element, and toggleable
 * repeatedly.
 *
 * Why it exists (external postmortem doc item C): input controls inside conditional
 * branches lose focus — `insertDynamic` compares by reference (`next === current`), so a
 * conditional expression rebuilds the subtree. The doc's countermeasure is "always render
 * + toggle visibility via a reactive class", written as:
 *
 * ```tsx
 * <div class={open.value ? 'panel is-open' : 'panel'}>   // easy to miss, easy to get wrong
 * <div class="panel" classList={{ 'is-open': open.value }}>  // now:
 * ```
 *
 * `classList` only manages its own contribution; class names the author wrote in `class`
 * are untouched.
 */
export function applyClassList(node: Element, value: unknown): void {
  const next = parseClassList(value)
  const previous = classListContributions.get(node) ?? []
  classListContributions.set(node, next)
  const base = (node.getAttribute('class') ?? '')
    .split(/\s+/u)
    .filter(name => name !== '' && !previous.includes(name))
  const merged = [...new Set([...base, ...next])]
  setAttribute(node, 'class', merged.join(' '))
}

function isClassListKey(key: string): boolean {
  return key === 'classList'
}

export function bindSpreadProps(node: Element, source: () => Record<string, unknown>): void {
  let previous: Record<string, unknown> | null = null
  effect(() => {
    const next = source() ?? {}
    const snapshot = { ...next }
    applySpreadProps(node, previous, next)
    previous = snapshot
  })
}

/** Apply compile-time host properties in one renderer pass. */
export function setStaticProps(node: Element, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key' || key === 'ref' || key.startsWith('on')) continue
    if (value === null || value === undefined) continue
    if (isClassListKey(key)) applyClassList(node, value)
    else if (isPropertyName(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, domAttributeName(key), key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }
}


function isStyleObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatStyle(value: Record<string, unknown>): string {
  return Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== false)
    .map(([key, entry]) => `${key.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)}:${String(entry)}`).join(';')
}

export function addEventListener(
  node: Element,
  event: string,
  handler: EventListener
): void {
  const renderer = getRenderer()
  const owner = getCurrentOwner()
  let bindings = eventBindings.get(node)
  if (!bindings) {
    bindings = new Map()
    eventBindings.set(node, bindings)
  }
  const previous = bindings.get(event)
  if (previous && previous.original === handler && previous.owner === owner) return
  if (previous) {
    // Detach the old listener first; its Owner cleanup slot is reused in place by the
    // slots logic below — nothing added or removed in the cleanup table
    renderer.removeEventListener(node, event, previous.handler)
  }
  const listener = owner ? (reason: Event) => {
    // A disposed Owner means the subtree owning the node was unmounted/replaced and the
    // event came from detached DOM — ignore it. Otherwise owner.run would throw
    // "disposed Owner", injecting meaningless error noise into the event stream.
    if (owner.disposed) return
    try {
      owner.run(() => handler(reason))
    } catch (error) {
      const handled = owner.handleError(error)
      invokeRuntimeDebug('error', {
        error,
        owner,
        phase: 'event',
        handled,
        recovery: handled ? 'handled' : 'propagated'
      })
      /*
       * Once handled by the owner's onError, the error's only remaining outlet is the
       * debug hook — without DevTools installed the console says nothing: an event
       * handler throws, the UI doesn't respond, and there's nothing to trace. The
       * unhandled case is rethrown below (the browser reports it itself), so the console
       * is only supplemented when "swallowed".
       */
      if (handled && getRuntimeDebugHooks()?.error === undefined) {
        console.error(formatVobsError(error, { includeStack: true }))
      }
      if (!handled) throw error
    }
  } : handler
  /*
   * This (node,event) occupies exactly **one** slot in the Owner cleanup table; when the
   * handler is replaced, what the slot does is swapped **in place**.
   *
   * If **every** addEventListener unconditionally called `owner.onDispose(...)`:
   * `Owner.cleanups` is a push-only array (reactivity/src/owner.ts) → each handler swap
   * adds a cleanup entry that never executes, with the old handler closure held captive.
   * Component effects rebind events on every re-run, so this is **unbounded growth** on
   * the hot path (equivalent to a memory leak on long-lived pages).
   *
   * `binding` is `const`, so the slot must wrap a mutable `current` — a rebind mutates
   * `current`, the array length stays unchanged, and the old closure is released.
   */
  const binding: EventBinding = { handler: listener, owner, original: handler }
  bindings.set(event, binding)
  renderer.addEventListener(node, event, listener)
  if (!owner) return
  /*
   * **Every (node,event) occupies exactly one slot in the Owner cleanup table.**
   *
   * If **every** addEventListener unconditionally called `owner.onDispose(...)`:
   * `Owner.cleanups` is a push-only array (reactivity/src/owner.ts) → each handler swap
   * adds a cleanup entry that never executes, with the old handler closure held captive.
   * Component effects rebind events on every re-run, so this is **unbounded growth** on
   * the hot path (equivalent to a memory leak on long-lived pages).
   *
   * Approach: the cleanup slot stores an **indirect reference**
   * (owner → (node,event) → current handle); a rebind only swaps what the indirect
   * reference points at, the slot itself never grows or shrinks, and it naturally expires
   * when the last reference is cleared. Keys are mapped to numbers via the per-owner
   * `eventCleanupKeys` to avoid long string prefix comparisons.
   */
  const key = eventCleanupKey(node, event)
  let slots = eventCleanupSlots.get(owner)
  if (!slots) {
    slots = new Map()
    eventCleanupSlots.set(owner, slots)
  }
  // The slot always stores "which binding should currently be cleaned up", so rebinding
  // or re-binding after removal just overwrites it
  const hasSlot = slots.has(key)
  slots.set(key, binding)
  if (hasSlot) return
  owner.onDispose(() => {
    const current = eventCleanupSlots.get(owner)?.get(key)
    if (!current) return
    eventCleanupSlots.get(owner)?.delete(key)
    const map = eventBindings.get(node)
    if (map?.get(event) === current) map.delete(event)
    renderer.removeEventListener(node, event, current.handler)
  })
}

export function removeEventListener(
  node: Element,
  event: string,
  handler: EventListener
): void {
  const renderer = getRenderer()
  const map = eventBindings.get(node)
  const binding = map?.get(event)
  /*
   * **Must compare handler identity** (that is exactly the DOM's `removeEventListener`
   * semantics).
   *
   * This used to ignore the passed-in `handler`: as long as a binding existed for
   * `(node,event)` it was always detached and the binding record deleted. So "remove with
   * a different handler" would mistakenly detach **someone else's** binding — the caller
   * thought it was only cancelling its own (which should have been a no-op), but actually
   * killed the currently active listener.
   *
   * Current behavior:
   * - binding exists and identity matches → detach (normal path)
   * - binding exists but identity differs → **no-op** (don't touch someone else's binding)
   * - no binding record (e.g. bound directly via the renderer elsewhere) → fall back to
   *   one detach with the passed-in handler, keeping usability when talking to the
   *   renderer API directly
   */
  if (binding) {
    if (binding.handler !== handler) return
    map?.delete(event)
  }
  renderer.removeEventListener(node, event, binding?.handler ?? handler)
}

/**
 * Clear a container.
 *
 * This used to only call the renderer's clear (the DOM implementation is
 * `textContent = ''`) — **not a single Owner of the cleared subtrees was released**:
 * effects inside components kept subscribing to signals (ghost updates), listeners stayed
 * bound, onDispose never ran. Now the Owners findable in the subtree are released first,
 * then the DOM is cleared.
 *
 * Coverage, stated honestly: `nodeOwners` only registers **component output nodes**
 * (`associateNodeOwner` at `createComponent` time). So cleanup at component boundaries is
 * complete (destroying a component's Owner cascades to its effects and child Owners);
 * but effects established directly outside components (e.g. `bindText`) are attached to
 * the caller's Owner at that moment and are not in the node table, so they **can't be
 * cleared here** — that part belongs to their Owner, usually handled by `app.destroy()`.
 * A complete fix would need the node table to support reverse enumeration, at a greater
 * cost; not done for now.
 *
 * Cleanup throwing does not prevent the DOM from being cleared (the release-first,
 * clear-after order also guarantees this).
 */
export function clear(container: Node): void {
  let firstError: unknown
  const walk = (node: Node): void => {
    try {
      disposeNodeOwner(node as unknown as VobsNode)
    } catch (error) {
      firstError ??= error
    }
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  for (const child of Array.from(container.childNodes)) walk(child)

  getRenderer().clear(container)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'clear',
      target: describeDebugNode(container as unknown as VobsNode),
      parent: describeDebugNode(container as unknown as VobsNode)
    })
  }
  if (firstError) throw firstError
}

/**
 * Component function.
 *
 * The return type **must include the empty values**: `null` / `undefined` / `false` are
 * all legal JSX forms (`cond ? <X/> : null`, `cond && <X/>`), and the runtime normalizes
 * them uniformly into an empty comment node.
 *
 * ⚠️ Declaring it too narrow hurts in practice: `return cond ? <div/> : null` would
 * report `Type 'null' is not assignable to type 'VobsNode'`, scaring the author into an
 * early-return rewrite — while the runtime fully supports `null` anyway.
 *
 * `VobsNode` itself is **not** loosened: it means "a real node"; passing `null` in
 * position arguments of `insertBefore` etc. is still an error. Emptiness is only legal
 * in the "component return value" position.
 */
type VobsComponent = (...args: any[]) => VobsNode | null | undefined | false

/*
 * Infer a component's props from its signature.
 *
 * The return type here is written `unknown`, not `VobsNode`: `VobsComponent`'s return is
 * a nullable domain (`VobsNode | null | undefined | false`), and hard-coding one member
 * would make this conditional type match no component at all, silently falling back to
 * `Record<string, never>` — showing up as `props` in `createComponent(Comp, props)`
 * becoming an empty object type and erroring with
 * "Record<string, unknown> is not assignable to Record<string, never>".
 */
type ComponentProps<Component extends VobsComponent> = Component extends (
  props: infer Props
) => unknown
  ? NonNullable<Props> extends object ? NonNullable<Props> : Record<string, never>
  : Record<string, never>

export function createComponent<Component extends VobsComponent>(
  component: Component,
  props: ComponentProps<Component>,
  source?: VobsSourceLocation
): VobsNode {
  const owner = createOwner()
  const componentName = (component as typeof component & { displayName?: string }).displayName
    || component.name
    || 'anonymous'
  setOwnerDebugName(owner, source
    ? `${componentName} (${source.file}:${source.line}:${source.column})`
    : componentName)
  owner.onError(reason => {
    attachSourceLocation(reason, source)
    attachComponentContext(reason, componentName, owner.id)
    throw reason
  })
  // HMR registration precedes the render-scope mark: the registration cleanup must survive
  // hot updates and must not be released by disposeSince as last round's render cleanup.
  const hmrKey = (component as typeof component & { hmrKey?: string }).hmrKey
  let instance: HmrInstance | null = null
  if (hmrKey) {
    const separator = hmrKey.lastIndexOf(':')
    const moduleId = separator < 0 ? hmrKey : hmrKey.slice(0, separator)
    instance = { node: null as unknown as VobsNode, parent: null, refresh: () => refreshInstance() }
    const cleanup = registerHmrInstance(moduleId, instance)
    owner.onDispose(cleanup)
  }
  // Render scope: the component Owner carries only HMR registration and error handling;
  // effects, onDispose entries (including portal cleanup) and nested component Owners
  // registered during each render all belong to that round's scope. Before an HMR refresh
  // re-renders it releases the previous scope, so stale instances' effects stop
  // subscribing to signals and portal nodes no longer pile up in body on every hot
  // update; the component Owner and the HMR registration stay alive.
  const renderScope = owner.mark()
  /*
   * Locally widen the type to the runtime's real value domain: a component returning
   * `null` / `undefined` / `false` is all legal JSX (`cond ? <X/> : null`,
   * `cond && <X/>`); only the `VobsComponent` declaration wrote it too narrow.
   * Normalized into an empty comment node below.
   */
  /*
   * Receive the render result in a **separate variable** before normalizing.
   * Writing `let node: VobsNode | null | undefined | false` directly and then comparing
   * `node === false` makes TS's control-flow analysis narrow `node` back to `VobsNode`
   * based on `component(props)`'s declared type, so the `false` branch is judged
   * "unreachable" and errors — yet at runtime it really does occur.
   */
  let rendered: unknown
  try {
    // Component rendering must be untracked: components are run-once, and when their
    // render happens inside some effect evaluation (the render factories of
    // insertDynamic/insertBoundary, route mounting), signals read in the component body
    // would be collected as the ancestor effect's dependencies without severing tracking —
    // one unrelated edit would then destroy and rebuild the whole subtree (inputs swapped
    // out, focus lost, event listeners cleaned away with the old tree).
    // Structural reactivity belongs only to conditional factories and binding effects;
    // the component body renders once and that's it.
    rendered = owner.run(() => untrack(() => component(props)))
  } catch (error) {
    owner.dispose()
    attachSourceLocation(error, source)
    attachComponentContext(error, componentName, owner.id)
    throw error
  }
  /*
   * When a component returns `null` / `undefined` / `false`, substitute a **comment node**.
   *
   * This is the root cause of a production incident (Labelune 2026-09-30 release
   * black screen): `createComponent` used the render result directly as a **WeakMap key**
   * for `nodeOwners`, and `null` / `undefined` are not legal keys —
   * `nodeOwners.set(null, owner)` throws `Invalid value used as weak map key`.
   * Especially costly consequences: the App crashed at mount, **with no JS crash log at
   * all**, and even the splash fallback failed; the only defense was human discipline
   * "components must always return a real node".
   *
   * "Conditional return null at the top of a component" is a legal JSX form; the framework
   * must not crash on it. A comment node is the **existing primitive that renders as
   * nothing** (fragment and dynamic markers both use it) — visually identical to
   * returning null, while satisfying the `VobsNode` contract — so downstream paths
   * (mounting, HMR refresh, node replacement, hydration) don't each need a special-case
   * "empty" branch.
   */
  const node: VobsNode = isRenderableNode(rendered) ? rendered : createComment('vobs:empty')
  associateNodeOwner(node, owner)
  if (instance) {
    instance.node = node
    associateHmrInstance(node, instance)
  }
  function refreshInstance(): void {
    // The component was unmounted together with the old render tree (e.g. the parent
    // completed its refresh first in the same hot update); it can't and needn't refresh again.
    if (owner.disposed) return
    const previous = instance!.node
    owner.disposeSince(renderScope)
    const rawNext = owner.run(() => untrack(() => component(props)))
    /*
     * The re-render path must **also** normalize empty return values — fixing only the
     * first-mount path would miss re-renders.
     *
     * The first-mount path (the `isRenderableNode(rendered) ? … : createComment('vobs:empty')`
     * above) handles empty values, but this update path didn't: when a component returns
     * `null` during a **re-render**, `nodeOwners.set(next as object, owner)` would get
     * `null` as a WeakMap key → throws `Invalid value used as weak map key`.
     *
     * Why it stayed hidden for so long: triggering it needs "component returns a node on
     * first render, then returns empty on some later re-render", while the (more common)
     * case of returning empty on the very first render takes the path fixed above.
     */
    const next: VobsNode = isRenderableNode(rawNext) ? rawNext : createComment('vobs:empty')
    const parent = instance!.parent
    if (parent) {
      // Insert the new tree before unmounting the old one: the replacement anchor is
      // always taken from the old tree still in the document, so any combination of
      // fragment and plain node forms locates the insertion point correctly.
      const anchor = isVobsFragment(previous) ? previous.start : previous
      if (isVobsFragment(next)) next.mount(parent, anchor)
      else getRenderer().insertBefore(parent, next, anchor)
      if (isVobsFragment(previous)) previous.unmount(parent)
      else getRenderer().removeChild(parent, previous)
    }
    nodeOwners.delete(previous as object)
    nodeOwners.set(next as object, owner)
    associateHmrInstance(next, instance!)
    instance!.node = next
  }
  return node
}

export interface VobsSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface VobsLocatedError extends Error {
  readonly vobsSource?: VobsSourceLocation
  readonly vobsComponent?: string
  readonly vobsOwnerId?: string
}

function attachSourceLocation(reason: unknown, source: VobsSourceLocation | undefined): void {
  if (!source || (!reason || (typeof reason !== 'object' && typeof reason !== 'function'))) return
  const error = reason as VobsLocatedError
  if (error.vobsSource) return
  try {
    Object.defineProperty(error, 'vobsSource', {
      configurable: true,
      enumerable: false,
      value: source,
      writable: false
    })
  } catch {
    // Frozen third-party errors still propagate with their original details.
  }
}

function attachComponentContext(reason: unknown, component: string, ownerId: string): void {
  if (!reason || (typeof reason !== 'object' && typeof reason !== 'function')) return
  const error = reason as VobsLocatedError
  try {
    if (!error.vobsComponent) Object.defineProperty(error, 'vobsComponent', { configurable: true, enumerable: false, value: component, writable: false })
    if (!error.vobsOwnerId) Object.defineProperty(error, 'vobsOwnerId', { configurable: true, enumerable: false, value: ownerId, writable: false })
  } catch {
    // Frozen third-party errors still propagate with their original details.
  }
}

export function createBlock(factory: () => VobsNode | null | undefined | false): VobsNode | null {
  const owner = createOwner()
  setOwnerDebugName(owner, 'dynamic')
  let node: VobsNode | null | undefined | false
  try {
    node = owner.run(factory)
  } catch (error) {
    owner.dispose()
    throw error
  }
  if (!node) {
    owner.dispose()
    return null
  }
  associateNodeOwner(node, owner)
  return node
}

/**
 * Whether a component render result is a **usable node value**.
 *
 * `VobsNode`'s real value domain is an object (`Node` / fragment / a custom renderer's
 * host object), while legal JSX forms may return `null` / `undefined` / `false`
 * (`cond ? <X/> : null`, `cond && <X/>`). A guard instead of a direct comparison is used
 * because `component()`'s declared type is `VobsNode`, and TS's control flow would judge
 * comparisons like `=== false` "unreachable".
 */
function isRenderableNode(value: unknown): value is VobsNode {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

export function associateNodeOwner(node: VobsNode, owner: Owner): void {
  /*
   * Defense: `node` is necessarily a `VobsNode` type-wise, but at runtime `null`/
   * `undefined` may arrive (component returned empty, a third-party renderer returned a
   * non-node). Using it directly as a WeakMap key throws
   * `Invalid value used as weak map key` — a **framework-internal error** with zero
   * information, which also makes the App mount crash silently. This assertion turns it
   * into an error that names the cause.
   */
  if (node === null || node === undefined || (typeof node !== 'object' && typeof node !== 'function')) {
    throw new Error(
      `Vobs: associateNodeOwner received a non-node value (${String(node)}). `
      + 'Components must return a VobsNode; null/undefined returns are converted into an empty comment node by createComponent.'
    )
  }
  nodeOwners.set(node, owner)
}

export function disposeNodeOwner(node: VobsNode): void {
  const owner = nodeOwners.get(node)
  if (!owner) return
  nodeOwners.delete(node)
  owner.dispose()
}
