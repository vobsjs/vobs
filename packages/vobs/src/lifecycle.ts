import { getCurrentOwner, onDispose, type Owner } from '@vobs/reactivity'

/**
 * Runs cleanup once **before** the component/scope unmounts (paired with `onMount`).
 *
 * External pitfall doc item D repeatedly said "timers/listeners **have no official
 * cleanup location**; cleanup is by convention only" — that is precisely the absence
 * of this API. This fills it in with a **standard name**.
 *
 * ## Relationship with `onDispose` (important — not two things)
 *
 * **They do the same thing** — `onDestroy` is exactly the cleanup registration on the
 * current Owner. `onDispose` comes from `@vobs/reactivity` (`@vobs/vobs` re-exports the
 * whole reactivity layer); the capability was always there. What was missing is this
 * name, and documentation about where it belongs.
 *
 * `onDestroy` is used as the **lifecycle-facing** name because it pairs with `onMount`,
 * while `onDispose` reads like the lower-level "Owner was disposed" primitive — either
 * works, behavior is identical.
 *
 * ## Typical usage (the hero carousel from item D)
 *
 * ```ts
 * let timer: ReturnType<typeof setInterval> | undefined
 * onMount(() => {
 *   timer = setInterval(() => index.value = (index.value + 1) % total, 5000)
 * })
 * onDestroy(() => {
 *   if (timer !== undefined) clearInterval(timer)
 * })
 * ```
 *
 * Note that timers created inside `onMount` **must be cleared in `onDestroy`**:
 * the `onMount` callback only runs on the client (no `document` on the server), so the
 * build process leaves no timers behind; but if the client never clears them on
 * unmount, they leak.
 *
 * ## Semantics
 *
 * - Registers on the **current Owner**; runs on component unmount / `app.destroy()` /
 *   scope disposal
 * - Like `onDispose`: cleanups run in **reverse order**, and **one failing cleanup does
 *   not stop the rest** (`owner.ts` isolates them one by one)
 * - Calling outside any Owner **throws** (not silently dropped — that would turn
 *   "cleanup never ran" into the hardest-to-trace leak)
 */
export function onDestroy(callback: () => void): void {
  if (typeof callback !== 'function') {
    throw new Error('Vobs: onDestroy requires a function')
  }
  if (!getCurrentOwner()) {
    throw new Error(
      'Vobs onDestroy: not currently inside any component/scope, so the cleanup would never run. '
      + 'Call it inside a component body or within effect/owner.run.'
    )
  }
  onDispose(callback)
}

/**
 * Runs once **after** the component/scope mounts.
 *
 * Why it exists: timers, `matchMedia`, `localStorage`, measuring element sizes — the
 * things that can only happen on the client — have **no safe place** in a component
 * body; apps had to hand-write `typeof window !== 'undefined'` guards or call directly
 * in the component body (and blow up or leak during SSG/prerender). This is the
 * official entry point for lifecycle capabilities.
 *
 * Semantics (consistent with run-once; don't read it with React `useEffect` intuition):
 *
 * - The callback runs once **after the current mount's synchronous work finishes**
 *   (via microtask), at which point the DOM is in the document — so measuring,
 *   focus, and `matchMedia` all work
 * - If the component **was unmounted before then**, the callback does not run (Owner check)
 * - Called outside any Owner, it **executes immediately** (e.g. module top level or a
 *   plain function) — not silently dropped, because "didn't run" is the hardest
 *   failure to trace
 * - Without `document` (Node-side SSR) it **does not run**: no browser APIs are
 *   available during prerender
 *
 * ⚠️ Honest boundary note: SSR detection is "is there a `document`". If you prerender
 * **in a DOM-carrying environment like jsdom**, the callback still runs — in such an
 * environment "is this prerender" cannot be reliably distinguished at runtime.
 * For scenarios needing a strict client guard, re-check inside the callback or use
 * the client branch of `@vobs/ssr`.
 *
 * Returns a cancel function: call it before the callback executes and it never runs.
 */
export function onMount(callback: () => void): () => void {
  if (typeof callback !== 'function') {
    throw new Error('Vobs: onMount requires a function')
  }
  const owner: Owner | null = getCurrentOwner()

  // No Owner (module top level / plain function): execute immediately, not silently dropped
  if (!owner) {
    runIfClient(callback)
    return () => { /* already ran, nothing to cancel */ }
  }

  let cancelled = false
  queueMicrotask(() => {
    if (cancelled) return
    // The component was unmounted before this → do not run (the "leak" half of doc item D)
    if (owner.disposed) return
    runIfClient(callback)
  })

  return () => { cancelled = true }
}

function runIfClient(callback: () => void): void {
  /*
   * No document means Node side (prerender) — browser APIs are unavailable there,
   * and running the callback would only throw or leak timers. Skipping is the
   * correct behavior here.
   */
  if (typeof document === 'undefined') return
  callback()
}
