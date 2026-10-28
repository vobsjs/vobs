import { getCurrentOwner, state } from '@vobs/reactivity'
import { insertDynamic } from './dynamic'
import { createFragment, type VobsNode } from './fragment'

export interface ClientOnlyProps {
  /** Content rendered only on the client. */
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
  /** Placeholder rendered on the server (and during the hydration first pass). */
  readonly fallback?: VobsNode | (() => VobsNode | null | undefined)
}

/**
 * `<ClientOnly>` — a subtree rendered only on the client.
 *
 * It completes the second half of pitfall D from the external postmortem doc:
 * `onMount` (`39c155b`) handles **side effects** (timers / matchMedia / localStorage),
 * while `ClientOnly` handles **rendering** — some subtrees simply cannot render on the
 * server (they depend on `window`, third-party widgets, or real layout measurement).
 *
 * ## Why it must be **two-phase** (the only thing that needs careful thought here)
 *
 * The naive implementation is "server renders nothing, client renders children" —
 * **that causes a hydration mismatch**: the server output lacks the subtree while the
 * client expects to claim it (strict hydration in this repo reports `missing-node`;
 * non-strict mode silently rebuilds, which shows up as content flicker).
 *
 * So:
 * 1. **First pass**: server and client **both** render `fallback` (renders nothing by
 *    default) — they match
 * 2. **After mount** (microtask): flip to "ready", `insertDynamic` swaps in `children`
 *
 * ## Where the parent comes from
 *
 * `createFragment` is used — its factory signature is `(parent, anchor) => void`,
 * **the framework hands in the parent and anchor at mount time**, so `insertDynamic`
 * can swap content directly without a wrapper element (a wrapper would change
 * flex/grid layout).
 *
 * ## Boundaries (stated honestly)
 *
 * The client check is `typeof document === 'undefined'` — the **same criterion** as
 * `onMount` (`39c155b`) and `@vobs/ssr`'s `prerender.ts`, with the same known limitation:
 * **when prerendering in a DOM-bearing environment like jsdom, it is judged to be the
 * client** (the framework currently has no "prerendering in progress" flag). In such an
 * environment ClientOnly's first pass renders `fallback` and swaps to `children` in a
 * microtask; hydration still matches (both first passes agree) — only "skip client
 * rendering" doesn't take effect.
 */
export function ClientOnly(props: ClientOnlyProps = {}): VobsNode {
  return createFragment((parent, anchor) => {
    const ready = state(false, 'ready')
    /*
     * Only queue this microtask when `document` exists — prerendering in Node must not
     * leave a side effect that runs later (it would let "server rendering" mutate the
     * finished output after renderToString returned).
     */
    if (typeof document !== 'undefined') {
      const owner = getCurrentOwner()
      queueMicrotask(() => {
        // Component was unmounted before this ran → don't flip (same defense as onMount)
        if (owner?.disposed) return
        ready.value = true
      })
    }
    insertDynamic(parent, anchor, () => {
      const slot = ready.value ? props.children : props.fallback
      // Typed as unknown: the declared type excludes false, but `cond && <X/>` yields false
      const value: unknown = typeof slot === 'function' ? slot() : slot
      return value === undefined || value === null || value === false ? null : (value as VobsNode)
    })
  })
}
