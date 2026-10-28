import { createOwner, onDispose, untrack } from '@vobs/reactivity'

export type DismissEvent = 'mousedown' | 'pointerdown'

export interface DismissOptions {
  /** The event to listen for (default `mousedown` — consistent with existing overlays like @vobs/table rowMenu). */
  readonly event?: DismissEvent
  /** Extra nodes treated as "inside" (trigger buttons etc. — clicking them doesn't close; their own handler decides open/close). */
  readonly also?: readonly Node[]
  /** Close on Escape (enabled by default). */
  readonly escape?: boolean
  /**
   * preventDefault on mousedown **inside** the overlay (disabled by default).
   *
   * Purpose: keep the input's focus/selection when a menu item is pressed
   * (edit-menu execCommand scenario) — preventDefault blocks the focus shift,
   * click still fires normally. Do not enable this when the overlay contains
   * inputs (clicking an input would no longer focus it).
   */
  readonly keepFocusInside?: boolean
}

/**
 * The standard "close on outside click" primitive for overlays — turns the two
 * recurring pitfalls of Finora pitfall list §8 into **something you can't
 * structurally write anymore**.
 *
 * ```ts
 * effect(() => {
 *   if (!open.value) return
 *   useDismiss(popupEl, () => { open.value = false })
 * })
 * ```
 *
 * ## The two pitfalls it cures (frequently reintroduced by hand-written document
 * mousedown capture listeners)
 *
 * 1. **Menu item clicks all dead**: a hand-written `document mousedown` capture listener
 *    for "close on outside click" fires before click when a menu item is pressed, and an
 *    immediate close() removes the overlay DOM at the root → click lands on a dead node.
 *    This primitive **returns on inside hits** — a mousedown inside the overlay never
 *    triggers a close; menu items run their own onclick and close themselves.
 * 2. **Edit-menu execCommand completely broken**: mousedown's default behavior moves
 *    focus away from the input and clears the selection. With `keepFocusInside: true`,
 *    mousedown inside the overlay gets preventDefault (keeping focus/selection).
 *
 * ## Semantics
 *
 * - Inside detection uses `contains` (including the overlay itself) — consistent with
 *   the @vobs/table rowMenu popup
 * - `close()` runs in **untrack**: signal writes inside the callback establish no
 *   subscription (structurally immune to C210)
 * - Escape-to-close is enabled by default (can be turned off)
 * - Lifecycle: creates its own Owner internally, **automatically attached to the calling
 *   component's Owner** (cascade cleanup on unmount); after close fires, the Owner
 *   disposes itself (the overlay is closed, listeners no longer needed). Repeated
 *   close is idempotent
 */
export function useDismiss(popup: Node, close: () => void, options: DismissOptions = {}): void {
  const type: DismissEvent = options.event ?? 'mousedown'
  const also = options.also

  const owner = createOwner()
  let done = false
  const closeOnce = (): void => {
    if (done) return
    done = true
    owner.dispose()
    untrack(close)
  }

  owner.run(() => {
    const isInside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      if (popup.contains(target)) return true
      return also?.some(node => node.contains(target)) ?? false
    }

    const onDown = (event: Event): void => {
      if (isInside(event.target)) {
        if (options.keepFocusInside === true) event.preventDefault()
        return
      }
      closeOnce()
    }

    const onKeyDown = (event: Event): void => {
      if (options.escape === false) return
      if ((event as KeyboardEvent).key === 'Escape') closeOnce()
    }

    document.addEventListener(type, onDown, true)
    document.addEventListener('keydown', onKeyDown)
    onDispose(() => {
      document.removeEventListener(type, onDown, true)
      document.removeEventListener('keydown', onKeyDown)
    })
  })
}
