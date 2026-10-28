/**
 * Development guardrails — turn the two classes of "silently broken" patterns in
 * vobs into structured errors.
 *
 * Why this exists: the mistakes models (and humans) most easily make on vobs are
 * precisely the ones that **fail silently**. The classic case is effect
 * self-subscription — `effect(() => { count.value++ })` reschedules itself;
 * in real measurements it kept re-running for hundreds of rounds without
 * erroring or crashing, just getting slower, until it got buried under some
 * other problem. Given that feedback, an AI just re-applies the same broken
 * pattern.
 *
 * The output is the framework's existing `VobsError` (`layer: 'constraint'`),
 * not a new shape — so the terminal / DevTools / devtools panel can reuse
 * `formatVobsError` and the same field set:
 * `code` / `severity` / `fix` / `location` / `example`.
 *
 * Implementation: **built entirely on the existing debug hooks of
 * `@vobs/reactivity`**, no hot-path changes, no runtime overhead
 * (`hasDebugHooks()` short-circuits when nobody installed hooks). The tradeoff
 * is that guardrails can only **report**, not interrupt — exceptions inside
 * hooks are swallowed by `invokeDebug`, which is a deliberate guarantee
 * (debug tooling must never change application behavior).
 *
 * Usage:
 * ```ts
 * import { installDevGuardrails } from '@vobs/vobs/dev'
 *
 * if (import.meta.env.DEV) {
 *   installDevGuardrails({ onViolation: v => devkit.report(v) })
 * }
 * ```
 */

import {
  getDebugHooks,
  getSignalDebugName,
  setDebugHooks,
  type Dependency,
  type Effect,
  type Owner,
  type ReactivityDebugHooks,
  type ReadableSignal
} from '@vobs/reactivity'
import { VobsError, formatVobsError, type VobsErrorLocation } from '@vobs/runtime/error'
import { vobsC210Example, vobsC210Fix } from '@vobs/runtime'

/** An effect wrote to a signal it depends on — the most common self-subscription. */
export const VOBS_C210 = 'VOBS_C210'
/** The same effect ran an abnormal number of times within the time window — a catch-all for cross-effect trigger loops. */
export const VOBS_C211 = 'VOBS_C211'

/** One guardrail hit: the structured error plus the accumulated hit count for that location. */
export interface GuardrailViolation {
  readonly error: VobsError
  /** Which hit this is at the same location. First report is 1. */
  readonly count: number
}

export interface DevGuardrailOptions {
  /** Called once per violation; merged counts at the same location call it again with an incremented count. */
  onViolation?: (violation: GuardrailViolation) => void
  /**
   * If the same effect runs more than this many times within the time window, it is
   * judged a loop. Default 50.
   * Why a time window instead of flush boundaries: the scheduler may open a flush
   * per write, so a loop can span flushes and flush-based counting would miss it;
   * a real loop always runs many times in a very short span.
   */
  effectRerunLimit?: number
  /** Time window (ms) for the re-run statistics. Default 100. */
  rerunWindowMs?: number
  /** Whether to also log via `formatVobsError` to console.error (default true). */
  console?: boolean
  /** How many distinct locations to report at most (keeps a loop from exhausting memory). Default 50. */
  maxSites?: number
}

let active: (() => void) | null = null

/**
 * Internal stack frame function names. **Skip by function name, not by
 * directory** — directory filtering would hit users' own files (a project can
 * legitimately have `src/effect.ts`), whereas these names are the framework's
 * own implementation details.
 */
const INTERNAL_FRAMES = /^(?:captureLocation|effectCreated|effectRunStart|effectRunEnd|signalChanged|invokeDebug|trackDependency|effect|renderEffect|run)$/u

/** Find the first user-code frame in the stack and convert it to the framework's unified location shape. */
function captureLocation(): VobsErrorLocation | undefined {
  const stack = new Error().stack
  if (stack === undefined) return undefined
  for (const raw of stack.split('\n').slice(1)) {
    const text = raw.trim()
    if (!text.startsWith('at ')) continue
    const body = text.slice(3)
    const named = /^(\S+?)\s+\((.+)\)$/u.exec(body)
    const frameName = named?.[1]
    const where = named?.[2] ?? body
    if (frameName !== undefined && INTERNAL_FRAMES.test(frameName)) continue
    if (where.includes('node_modules')) continue
    if (/[/\\]dev\.(?:ts|js|cjs|mjs)$/u.test(where)) continue
    const match = /^(.+?):(\d+):(\d+)$/u.exec(where)
    if (match === null) continue
    return { file: match[1], line: Number(match[2]), column: Number(match[3]) }
  }
  return undefined
}

function signalLabel(signal: ReadableSignal<unknown>): string {
  const name = getSignalDebugName(signal)
  return name === undefined ? '(unnamed signal)' : `"${name}"`
}

/**
 * When the signal has no name, add a line on **why** and **how to fix**.
 *
 * ## Measured causes (not speculation)
 *
 * The compiler's `inferStateDebugName` only infers a name from the variable when
 * `state` is **imported directly from `@vobs/reactivity` / `@vobs/vobs`**.
 * Four shapes, measured:
 *
 * ```
 * named    .tsx direct import
 * named    .ts  direct import          ← independent of file extension
 * unnamed  .ts  imported via our own barrel re-export
 * unnamed  .tsx imported via our own barrel re-export
 * ```
 *
 * The real culprit is **barrel re-export**, not ".ts files not being compiled"
 * (my first hypothesis was wrong). Detecting barrels requires cross-file module
 * resolution, and the compiler's transform is **per-file** — it cannot do that.
 *
 * ## Why this is said here
 *
 * Seeing `(unnamed signal)` gives no clue what to change, only manual backtracking —
 * in real feedback this was the most expensive step. The fix is a **one-line
 * import change** (or passing the debug name explicitly), so the error itself
 * must say it.
 */
function unnamedSignalHint(signal: ReadableSignal<unknown>): string {
  if (getSignalDebugName(signal) !== undefined) return ""
  return "\n  This signal has no name — common cause: `state` is imported through **your own barrel / re-export**"
    + " (the compiler only auto-names `state` imported directly from `@vobs/reactivity` / `@vobs/vobs`)."
    + " Import it directly, or pass the name explicitly: `state(initial, \"entSync\")`. With a name, this error points at it directly."
}

/**
 * Install the development guardrails and return the uninstall function.
 * Repeated calls are idempotent (they return the same uninstall function).
 */
export function installDevGuardrails(options: DevGuardrailOptions = {}): () => void {
  if (active !== null) return active

  const notify = options.onViolation
  const toConsole = options.console !== false
  const rerunLimit = options.effectRerunLimit ?? 50
  const rerunWindowMs = options.rerunWindowMs ?? 100
  const maxSites = options.maxSites ?? 50

  /** Stack of currently running effects (effects can nest). */
  const running: Effect[] = []
  /** Per-effect run count inside the current time window. WeakMap: holds no reference once the effect is released. */
  const bursts = new WeakMap<Effect, { runs: number; startedAt: number }>()
  /**
   * Each effect's **creation location**.
   *
   * Must be captured once at `effectCreated` and remembered: re-runs happen in
   * the scheduler's microtask, where the call stack contains no user code at
   * all — capturing per re-run would report several different locations for
   * the same effect, hiding the source.
   */
  const sites = new WeakMap<Effect, VobsErrorLocation | undefined>()
  /** One entry per location; afterwards only the count accumulates. */
  const seen = new Map<string, GuardrailViolation>()

  const emit = (error: VobsError): void => {
    const key = `${error.code}@${error.location?.file ?? '?'}:${error.location?.line ?? '?'}`
    const existing = seen.get(key)
    if (existing !== undefined) {
      const merged: GuardrailViolation = { error: existing.error, count: existing.count + 1 }
      seen.set(key, merged)
      notify?.({ error: merged.error, count: merged.count })
      return
    }
    if (seen.size >= maxSites) return
    const violation: GuardrailViolation = { error, count: 1 }
    seen.set(key, violation)
    if (toConsole) console.error(formatVobsError(error, { environment: 'development' }))
    notify?.({ error, count: 1 })
  }

  const previous = getDebugHooks()

  const hooks: ReactivityDebugHooks = {
    ...previous,

    effectCreated(effect: Effect, owner: Owner | null): void {
      // The only moment where a user-code stack is available
      sites.set(effect, captureLocation())
      previous?.effectCreated?.(effect, owner)
    },

    effectRunStart(effect: Effect): void {
      running.push(effect)

      // Read-side catch-all: what dependency detection misses (typically two
      // effects triggering each other) shows up here
      const now = Date.now()
      const burst = bursts.get(effect)
      if (burst === undefined || now - burst.startedAt > rerunWindowMs) {
        bursts.set(effect, { runs: 1, startedAt: now })
      } else {
        burst.runs += 1
        if (burst.runs === rerunLimit) {
          emit(new VobsError({
            code: VOBS_C211,
            severity: 'error',
            layer: 'constraint',
            location: sites.get(effect),
            message: `The same effect ran ${burst.runs} times within ${rerunWindowMs}ms — most likely self-subscription, or two effects triggering each other`,
            fix: 'Preferred: declare dependencies explicitly with `effect(on(deps, () => { … }))` (on keeps reads inside the callback untracked); '
              + 'use memo for values derived from other signals instead of "read A, write B"; '
              + 'as a last resort wrap the write to a signal this effect reads in untrack.'
              + 'Note that code in the called function **before the first await** also runs synchronously — '
              + '"only calling a function" inside the effect does not mean no dependencies (compile-time VOBS_C106 flags async callbacks).',
            docs: 'https://github.com/vobsjs/vobs/blob/main/docs/dev-guardrails.md'
          }))
        }
      }

      previous?.effectRunStart?.(effect)
    },

    effectRunEnd(effect: Effect, error?: unknown, handled?: boolean): void {
      const index = running.lastIndexOf(effect)
      if (index >= 0) running.splice(index, 1)
      previous?.effectRunEnd?.(effect, error, handled)
    },

    signalChanged(signal: ReadableSignal<unknown>, previousValue: unknown, nextValue: unknown): void {
      previous?.signalChanged?.(signal, previousValue, nextValue)

      const current = running[running.length - 1]
      if (current === undefined || current.disposed) return
      // This effect currently subscribes to this signal: the write will reschedule it → self-subscription
      if (!current.dependencies.has(signal as unknown as Dependency)) return

      const label = signalLabel(signal)
      const bare = label.replace(/"/gu, '')
      emit(new VobsError({
        code: VOBS_C210,
        severity: 'error',
        layer: 'constraint',
        location: sites.get(current),
        message: `Effect wrote to signal ${label} that it depends on — this write reschedules it, forming a self-subscription loop`
        + unnamedSignalHint(signal),
        /*
         * The fix order matters a lot: **teach the structure first, then the patch**.
         *
         * Teaching only `untrack(...)` is not enough — that is a **local patch**: it
         * stops this write from triggering a re-run, but never answers "why does this
         * effect subscribe to it", and it relies on a person remembering to write it —
         * it is not structure.
         *
         * Preferred is `on()`: explicit dependency declaration, the callback runs in an
         * untrack scope, so any function it calls can touch any signal without
         * reverse-subscribing — the mistake becomes **structurally impossible to write**.
         * Second choice is switching to a derived value / memo.
         */
        // Shares the **same copy** as the static rule (analyze in @vobs/compiler) —
        // previously each side had its own text; 1.8.5 only updated this one, the
        // static rule still had the old text, so the vite channel gave outdated advice.
        fix: vobsC210Fix(bare),
        example: vobsC210Example(bare),
        docs: 'https://github.com/vobsjs/vobs/blob/main/docs/dev-guardrails.md'
      }))
    }
  }

  setDebugHooks(hooks)

  const uninstall = (): void => {
    setDebugHooks(previous)
    running.length = 0
    seen.clear()
    active = null
  }
  active = uninstall
  return uninstall
}

/** Whether the guardrails are currently installed. */
export function isDevGuardrailsInstalled(): boolean {
  return active !== null
}
