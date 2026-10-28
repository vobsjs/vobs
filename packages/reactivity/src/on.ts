import { untrack, type ReadableSignal } from './signal'

/** Dependency sources accepted by `on`: a single signal, an array of signals, or a getter function. */
export type OnDependency<T> =
  | ReadableSignal<T>
  | readonly ReadableSignal<unknown>[]
  | (() => T)

export interface OnOptions {
  /**
   * The first evaluation only **records** the dependency values and does not call
   * the callback (Solid's `{ defer: true }`).
   *
   * Purpose: act only when a dependency **changes**, without running once on mount.
   */
  readonly defer?: boolean
}

/**
 * **Declare an effect's dependencies explicitly** — solves a whole class of
 * structural pitfalls in fine-grained reactivity.
 *
 * ```ts
 * effect(on(session, () => { void syncEnterpriseTemplates() }))
 * ```
 *
 * ## Why it is needed
 *
 * `effect` dependencies are **auto-collected**: any signal read inside the callback
 * body becomes a dependency. And **"the effect merely calls a function" does not
 * mean it has no dependencies** — code in the called function before its
 * **first `await`** runs synchronously, so every signal it reads/writes is
 * attributed to the effect:
 *
 * ```ts
 * // ❌ The guard read + the state-machine write both happen before sync()'s first await
 * effect(() => { if (session.value) void sync() })
 * //   → the effect subscribes to ent.sync (read inside sync())
 * //   → sync() writes ent.sync → re-triggers the effect → infinite resync (C210 + C211)
 * ```
 *
 * The countermeasure can also be written with `untrack`:
 *
 * ```ts
 * effect(() => { if (session.value) untrack(() => { void sync() }) })
 * ```
 *
 * **It works, but relies on people remembering.** `on` makes it
 * **structurally impossible to get wrong**: the callback runs inside an `untrack`
 * scope, so no signal touched by the functions it calls can subscribe it back.
 *
 * ## Unrelated to async
 *
 * What it governs is "an effect must not be dragged around by signals its called
 * function touches" — **regardless of whether that function is async**; the
 * synchronous segment reading/writing signals is just one instance of it.
 *
 * ## Semantics (aligned with SolidJS's `on()`)
 *
 * - **Fires only when the declared dependencies change**: reads inside the callback
 *   body establish no subscriptions
 * - `previous` is the **previous** dependency value (`undefined` on the first run)
 * - With `defer: true`, the first evaluation only records and does not call
 * - The dependencies themselves are still tracked normally — this is **not** a
 *   replacement for `untrack`; it makes the "dependency list" explicit
 */
export function on<T, R>(
  deps: OnDependency<T>,
  fn: (value: T, previous: T | undefined) => R,
  options: OnOptions = {}
): () => R | undefined {
  const readDeps = createDepsReader(deps)
  let previous: T | undefined
  let primed = false

  return (): R | undefined => {
    // Dependency reads happen inside the **tracking scope** — the only thing that should subscribe
    const value = readDeps()

    if (!primed) {
      primed = true
      previous = value
      if (options.defer) return undefined
    } else {
      const last = previous
      previous = value
      /*
       * The callback runs inside untrack: signals it reads do not subscribe back.
       * The return value is passed through as-is (effect supports a return value as cleanup).
       */
      return untrack(() => fn(value, last))
    }
    return untrack(() => fn(value, undefined))
  }
}

function createDepsReader<T>(deps: OnDependency<T>): () => T {
  if (typeof deps === 'function') return deps as () => T
  if (Array.isArray(deps)) {
    const list = deps as readonly ReadableSignal<unknown>[]
    return () => list.map(signal => signal.value) as unknown as T
  }
  const signal = deps as ReadableSignal<T>
  if (signal && typeof signal === 'object' && 'value' in signal) return () => signal.value
  throw new Error(
    'Vobs on(): the first argument must be a signal (has .value), an array of signals, or a getter function. '
    + 'Passing a plain value establishes no subscription — the effect would never be triggered.'
  )
}
