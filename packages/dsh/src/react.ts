/**
 * React binding.
 *
 * DSH slots only accept React components, while vobs needs to mount its own render tree
 * into the host element, so the adapter must get React — but React must **not** be bundled
 * into the artifact: it is a built-in module in DSH's platform module table, and only
 * `require('react')` yields the same instance.
 *
 * Two lookup paths, in order:
 *   1. `useDshReact(react)` — manual injection, for people with their own build pipeline;
 *   2. `globalThis.__VOBS_DSH_REACT__` — injected automatically by `dshBundle()` at build
 *      time, writing the result of `require('react')` as the first line of the factory body.
 *
 * If both fail, we throw with both remedies in the message.
 */

/** The React surface this adapter actually uses; kept minimal to avoid clashing with real React types. */
export interface DshReact {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  useRef<T>(initial: T | null): { current: T | null }
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/** Global key where `dshBundle()` writes React inside the factory. */
export const DSH_REACT_GLOBAL = '__VOBS_DSH_REACT__'

let injected: DshReact | undefined

/** Manually inject the React binding (e.g. `useDshReact(require('react'))`). */
export function useDshReact(react: DshReact): void {
  injected = react
}

/** Resolve the React binding; both `dshBundle()`'s auto-injection and manual injection go through here. */
export function resolveDshReact(): DshReact {
  const fromGlobal = (globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] as DshReact | undefined
  const react = injected ?? fromGlobal
  if (!react) {
    throw new Error(
      '@vobs/dsh: cannot obtain the React provided by the DSH platform.\n' +
        '  Build the client artifact with dshBundle() (it injects automatically), or call useDshReact(require("react")) in your entry module.'
    )
  }
  return react
}

/** For tests only: clear the manually injected binding. */
export function resetDshReact(): void {
  injected = undefined
}
