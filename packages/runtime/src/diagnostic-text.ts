/**
 * **Single source of truth** for diagnostic copy.
 *
 * ## Why it exists
 *
 * `VOBS_C210` (effect self-subscription) has **two implementations**, appearing on two channels:
 *
 * | Implementation | Location | Channel |
 * |---|---|---|
 * | Static rule | `analyze.ts` in `@vobs/compiler` | `vobs check` / `vite dev` / `vite build` |
 * | Runtime guard | `dev.ts` in `@vobs/vobs` | browser console / `check:runtime` |
 *
 * The two implementations **must share the same copy**: written separately each gets revised
 * on its own and some channel ends up showing stale advice (the compiler/analyzer/guard trio
 * being fixed in only one place was a drift that actually happened).
 *
 * Both sides depend on `@vobs/runtime`, so the copy lives here → **structurally impossible
 * to drift again**, more thorough than "each side writes its own + a test comparing them".
 *
 * ## Principles of the copy (learned from real mistakes)
 *
 * **Teach the structure first, then the patch.** Handing out `untrack` alone is a local patch:
 * it stops this write from re-triggering the effect, but it never answers "why did this effect
 * subscribe to it", so the same class of problem keeps recurring
 * (real-world feedback: C210 is very frequent when developing with an LLM).
 */
export const VOBS_C210 = 'VOBS_C210'

/**
 * Fix copy for `VOBS_C210`. `name` is the signal name (unquoted).
 *
 * Order: ① declare dependencies explicitly with `on()` ② switch to a derived value / memo
 * ③ the last resort is `untrack`.
 */
export function vobsC210Fix(name: string): string {
  return 'Preferred: declare the dependencies explicitly with `effect(on(deps, () => { … }))` '
    + '(reads inside `on` do not subscribe, so a self-subscription cannot form structurally); '
    + 'or this write could have been a derived value / memo instead (the most common case is '
    + 'a "read A, write A" that actually wants to "derive a new value"). '
    + ` Last resort: sever the subscription for just this write with untrack(() => { ${name}.value = next }); `
    + 'if this effect was only ever meant to run a side effect, check whether it reads a signal it should not.'
}

/** Example code for `VOBS_C210`. */
export function vobsC210Example(name: string): string {
  return `effect(on(deps, () => {\n  // reads here do not subscribe\n  ${name}.value = next\n}))`
}
