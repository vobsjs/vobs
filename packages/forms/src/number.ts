/**
 * The **parsing contract** for numeric input (external pitfall doc #7 / optimization suggestion #7).
 *
 * ## Why it exists
 *
 * `Number('') === 0` — the instant the user clears the input box, the value is written into the
 * signal as `0`. In chains like "ratio locking / linked calculation", `0` turns into `Infinity`
 * through division and then zeroes the sibling dimensions too: **clearing one input box zeroes
 * several neighboring ones as well**. This is not a framework bug (`Number` is JS semantics),
 * but the framework can provide the correct default path.
 *
 * ## The contract
 *
 * Inputs with numeric semantics **always go through `parseNumber`**:
 * - empty string → **not committed** (previous value kept)
 * - invalid (`'abc'` / `'1.2.3'` / `'--'`) → **not committed**
 * - out of bounds (`min` / `max`) → **not committed** (not silently clamped — clamping makes the
 *   box show `100` while the user typed `999`, with a scrambled cursor, and the user never
 *   learns their input was altered)
 * - only **valid finite numbers** are committed
 *
 * Callers use `reason` to decide whether to give feedback (e.g. mark the box red / show
 * "Please enter a number").
 *
 * ## Why "not committed" instead of "commit 0" or "clamp"
 *
 * `0` pollutes the linked chain (see above); clamping masks the user's real input.
 * "Keep the previous value, do not commit" is the only choice that never produces **wrong
 * data** — the empty box on screen is represented by the input itself, and the signal still
 * holds the last valid value.
 */

/** Categories of parse failure — callers pick their feedback copy based on this. */
export type NumberParseFailure = 'empty' | 'invalid' | 'below-min' | 'above-max' | 'not-integer'

export type NumberParseResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: NumberParseFailure }

export interface ParseNumberOptions {
  /** Lower bound (inclusive). */
  readonly min?: number
  /** Upper bound (inclusive). */
  readonly max?: number
  /** Integers only. */
  readonly integer?: boolean
  /** Allow intermediate states like a leading `+` / trailing dot (default allows `'1.'`, since the user is still typing). */
  readonly allowTrailingDot?: boolean
}

/**
 * Parse input text into a number. **Never throws**; the result is expressed by the return value.
 *
 * ```ts
 * const parsed = parseNumber(input.value, { min: 0, max: 100 })
 * if (parsed.ok) ratio.value = parsed.value
 * // otherwise keep the previous value; use parsed.reason to give feedback when needed
 * ```
 */
export function parseNumber(text: string, options: ParseNumberOptions = {}): NumberParseResult {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid' }
  const trimmed = text.trim()
  // an empty string (pure whitespace included) is not committed — the **primary** reason this function exists
  if (trimmed === '') return { ok: false, reason: 'empty' }

  /*
   * Do not use `Number()` for validation: it is far too lenient —
   * `Number('0x10')` = 16, `Number('1e3')` = 1000, `Number(' 12 ')` = 12,
   * `Number('Infinity')` = Infinity. None of these is the expected behavior for "a box the user
   * is typing into". Use an explicit shape match; accept decimal digits only.
   */
  const allowTrailingDot = options.allowTrailingDot ?? true
  const pattern = allowTrailingDot
    ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u
    : /^[+-]?(?:\d+\.\d+|\d+|\.\d+)$/u
  if (!pattern.test(trimmed)) return { ok: false, reason: 'invalid' }

  const value = Number(trimmed)
  // even a shape-valid value can still be Infinity (overlong digits); it must be blocked
  if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' }

  if (options.integer === true && !Number.isInteger(value)) {
    return { ok: false, reason: 'not-integer' }
  }
  if (options.min !== undefined && value < options.min) {
    return { ok: false, reason: 'below-min' }
  }
  if (options.max !== undefined && value > options.max) {
    return { ok: false, reason: 'above-max' }
  }
  return { ok: true, value }
}

/** User-facing copy for parse failures (callers may also write their own). */
export function describeNumberParseFailure(reason: NumberParseFailure): string {
  switch (reason) {
    case 'empty': return 'Please enter a number'
    case 'invalid': return 'Please enter a valid number'
    case 'not-integer': return 'Please enter an integer'
    case 'below-min': return 'Value is too small'
    case 'above-max': return 'Value is too large'
  }
}
