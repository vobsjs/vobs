import { effect } from '@vobs/reactivity'
import { isVobsFragment, type VobsNode } from './fragment'
import { removeAttribute, setAttribute, setProperty } from './ops'

export interface ShowProps {
  /**
   * The condition. Pass a getter / signal read expression for reactivity
   * (the compiler auto-converts dynamic props into getters, so `when={open.value}`
   * in JSX is enough).
   */
  readonly when: unknown
  /**
   * The content to show. **Must be a single element** (`<div>` / `<input>` / an element
   * returned by a component all work) — because "keep mounted + toggle visibility" needs
   * a host element to carry `hidden`/`inert`, and the framework **will not insert a
   * wrapper for you** (a wrapper changes flex/grid layout — a subtler trap).
   */
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
  /** Extra class name applied while hidden (optional). By default only `hidden` + `inert` are used. */
  readonly hiddenClass?: string
}

/**
 * Conditional display that **keeps the subtree mounted** (no rebuild).
 *
 * ## Why it exists (external postmortem doc item C, ★★)
 *
 * `insertDynamic` compares by reference (`next === current`): when the condition
 * expression changes it **rebuilds the subtree**. The consequence is that input controls
 * inside the conditional branch **lose focus on every keystroke**, and scroll position
 * plus internal state are all lost.
 *
 * The doc's countermeasure is "always render + toggle visibility via a reactive class",
 * but that is **human discipline** — every page must remember to write it that way.
 * `Show` makes it one line:
 *
 * ```tsx
 * <Show when={open.value} hiddenClass="is-hidden">
 *   <input />        {/* however the condition changes, this input is never rebuilt; focus and state persist *\/}
 * </Show>
 * ```
 *
 * Division of labor with `{cond ? <A/> : <B/>}`:
 * - want to **preserve state** (inputs, scroll position, internal subsystems) → use `Show`
 * - want a **real unmount** (save memory, side effects must be destroyed) → use a JSX
 *   conditional expression (the compiler generates a conditional factory)
 *
 * ## `inert` is set alongside `hidden`
 *
 * With `hidden` alone the element can still be Tab-reachable in some scenarios
 * (see `@vobs/layout` for the same treatment). `inert` removes the subtree from the
 * **focus order and the accessibility tree**. In old browsers without support,
 * `inert=""` is just a harmless unknown attribute; `hidden` still backstops.
 *
 * ## Boundary
 *
 * When the child is not a single element (text / fragment / multiple nodes) it
 * **throws and explains why** — it does not silently degrade to "unmount" (that would
 * make the user believe state was preserved while in fact everything rebuilds on each
 * change — exactly the shape of bug C). To preserve state, wrap the content in one element.
 */
export function Show(props: ShowProps): VobsNode {
  /*
   * Receive as `unknown` then null-check: the declared type of `props.children` excludes
   * `false`, but at runtime forms like `cond && <X/>` do yield `false` —
   * comparing directly makes TS call it "unreachable" (same pitfall as `createComponent`).
   */
  const resolved: unknown = typeof props.children === 'function' ? props.children() : props.children
  if (resolved === null || resolved === undefined || resolved === false) {
    throw new Error('Vobs Show: children cannot be empty — it needs a host element to carry hidden/inert.')
  }
  const node = resolved as VobsNode
  if (isVobsFragment(node) || (node as Element).nodeType !== 1) {
    throw new Error(
      'Vobs Show: children must be a single element. '
      + '"Keep mounted + toggle visibility" needs a host element, and the framework will not insert a wrapper for you (it would change layout). '
      + 'Wrap the content in an element, e.g. <Show when={…}><div>…</div></Show>; '
      + 'if you truly need unmount semantics, use a JSX conditional expression {cond ? <A/> : <B/>} instead.'
    )
  }
  const element = node as Element

  effect(() => {
    const visible = Boolean(readMaybeGetter(props.when))
    /*
     * Visibility toggling touches exactly three things: `hidden`, `inert`, and the
     * optional class name. It reads no signal inside itself (the `when` read happens
     * inside the effect, via the caller-provided getter), so it cannot self-subscribe.
     */
    setProperty(element, 'hidden', !visible)
    if (visible) removeAttribute(element, 'inert')
    else setAttribute(element, 'inert', '')
    if (props.hiddenClass !== undefined) applyExtraClass(element, props.hiddenClass, !visible)
  })

  return element
}

function readMaybeGetter<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}

/** Add or remove one class name as needed (leaves the other classes authored in `class` untouched). */
function applyExtraClass(element: Element, className: string, on: boolean): void {
  const names = element.getAttribute('class')?.split(/\s+/u).filter(Boolean) ?? []
  if (on) {
    if (names.includes(className)) return
    setAttribute(element, 'class', [...names, className].join(' '))
    return
  }
  if (!names.includes(className)) return
  setAttribute(element, 'class', names.filter(name => name !== className).join(' '))
}

export { readMaybeGetter }
