/** Shared error protocol used by the runtime, compiler and DevTools. */
export type VobsErrorSeverity = 'error' | 'warning' | 'info'
export type VobsErrorLayer =
  | 'compiler'
  | 'runtime'
  | 'constraint'
  | 'permission'
  | 'ssr'
  | 'http'
  | 'resource'

export interface VobsErrorLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface VobsErrorOptions {
  readonly code: string
  readonly message: string
  readonly severity?: VobsErrorSeverity
  readonly layer?: VobsErrorLayer
  readonly cause?: unknown
  readonly fix?: string
  readonly location?: VobsErrorLocation
  readonly trace?: readonly string[]
  readonly example?: string
  readonly docs?: string
  readonly codeFrame?: string
}

export interface VobsErrorDefaults {
  readonly code?: string
  readonly severity?: VobsErrorSeverity
  readonly layer?: VobsErrorLayer
  readonly fix?: string
}

/** A framework error with stable machine-readable metadata. */
export class VobsError extends Error {
  readonly code: string
  readonly severity: VobsErrorSeverity
  readonly layer: VobsErrorLayer
  readonly cause?: unknown
  readonly fix?: string
  readonly location?: VobsErrorLocation
  readonly trace?: readonly string[]
  readonly example?: string
  readonly docs?: string
  readonly codeFrame?: string

  constructor(options: VobsErrorOptions) {
    super(options.message)
    this.name = 'VobsError'
    this.code = options.code
    this.severity = options.severity ?? 'error'
    this.layer = options.layer ?? 'runtime'
    this.cause = options.cause
    this.fix = options.fix
    this.location = options.location
    this.trace = options.trace
    this.example = options.example
    this.docs = options.docs
    this.codeFrame = options.codeFrame
  }
}

export function createVobsError(options: VobsErrorOptions): VobsError {
  return new VobsError(options)
}

/**
 * Structured recognition (does not rely on `instanceof`).
 *
 * **We must not require `layer` to be present as well** — it used to require code + message +
 * layer to all be strings, so a caller passing `{ code, message }` was judged "not a VobsError",
 * fell into the final `String(value)` fallback, and printed `[object Object]`: the diagnostic
 * system lost its own diagnostics. A missing layer gets a default value filled in at
 * construction below; there is no reason to reject it at the recognition stage.
 */
export function isVobsError(value: unknown): value is VobsError {
  return value instanceof VobsError
    || Boolean(value && typeof value === 'object'
      && typeof (value as { code?: unknown }).code === 'string'
      && typeof (value as { message?: unknown }).message === 'string')
}

/**
 * A VobsError created by another bundled copy.
 *
 * tsup `splitting: false` puts error.ts into both `dist/index.js` and `dist/error.js`,
 * and the two classes are not `instanceof` each other. All fields are there, only identity
 * differs — recognize it and copy it into a local instance.
 */
function isForeignVobsError(value: unknown): value is Error & VobsErrorOptions {
  return value instanceof Error
    && value.name === 'VobsError'
    && typeof (value as { code?: unknown }).code === 'string'
}

/** Fallback message extraction: at least read the object's `message`; never print `[object Object]` again. */
function describeUnknown(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Copy the fields of a "VobsError-like" value from any source into a local instance. */
function adoptVobsError(
  value: VobsErrorOptions & { cause?: unknown },
  defaults: VobsErrorDefaults
): VobsError {
  return new VobsError({
    code: value.code,
    message: value.message,
    severity: value.severity ?? defaults.severity,
    layer: value.layer ?? defaults.layer,
    cause: value.cause ?? (value instanceof Error ? value : undefined),
    fix: value.fix ?? defaults.fix,
    location: value.location,
    trace: value.trace,
    example: value.example,
    docs: value.docs,
    codeFrame: value.codeFrame
  })
}

/** Convert thrown strings and third-party errors without losing their message. */
export function normalizeVobsError(value: unknown, defaults: VobsErrorDefaults = {}): VobsError {
  // Local instance: return as-is, preserving identity and the existing stack
  if (value instanceof VobsError) return value

  // Created by another copy: adopt into a local instance so downstream instanceof holds
  if (isForeignVobsError(value)) return adoptVobsError(value, defaults)

  if (value instanceof Error) {
    // Preserve the original Error identity so boundaries and DevTools can
    // correlate event/effect phases without creating duplicate diagnostics.
    const metadata = value as Error & {
      readonly vobsCode?: unknown
      readonly vobsHint?: unknown
      readonly vobsSource?: unknown
    }
    const code = defaults.code ?? (typeof metadata.vobsCode === 'string' ? metadata.vobsCode : undefined)
    if (code) {
      defineErrorMetadata(value, 'code', code)
      /*
       * Metadata cannot be attached to frozen / non-extensible third-party Errors. This
       * used to be swallowed silently, so normalize's result had code === undefined
       * (printed as VOBS_UNKNOWN). If it can't be attached, adopt into a local instance
       * instead of dropping the code.
       */
      if ((value as { code?: unknown }).code !== code) {
        return new VobsError({
          code,
          message: value.message,
          severity: defaults.severity ?? 'error',
          layer: defaults.layer ?? 'runtime',
          cause: value,
          fix: defaults.fix ?? (typeof metadata.vobsHint === 'string' ? metadata.vobsHint : undefined)
        })
      }
    }
    defineErrorMetadata(value, 'severity', defaults.severity ?? 'error')
    defineErrorMetadata(value, 'layer', defaults.layer ?? 'runtime')
    const fix = defaults.fix ?? (typeof metadata.vobsHint === 'string' ? metadata.vobsHint : undefined)
    if (fix) defineErrorMetadata(value, 'fix', fix)
    const source = metadata.vobsSource
    if (source && typeof source === 'object'
      && typeof (source as { file?: unknown }).file === 'string'
      && typeof (source as { line?: unknown }).line === 'number'
      && typeof (source as { column?: unknown }).column === 'number') {
      defineErrorMetadata(value, 'location', source)
    }
    return value as VobsError
  }

  // Structured object (may lack layer, even severity): fill defaults and construct a local VobsError
  if (isVobsError(value)) return adoptVobsError(value as VobsErrorOptions, defaults)

  return new VobsError({
    code: defaults.code ?? 'VOBS_UNKNOWN',
    message: describeUnknown(value),
    severity: defaults.severity ?? 'error',
    layer: defaults.layer ?? 'runtime',
    cause: undefined,
    fix: defaults.fix
  })
}

function defineErrorMetadata(target: Error, key: string, value: unknown): void {
  if (key in target) return
  try {
    Object.defineProperty(target, key, { configurable: true, enumerable: false, value, writable: true })
  } catch {
    // Frozen / non-extensible third-party Error: metadata cannot be attached. The caller
    // detects success by "write then read back", and on failure adopts into a local
    // instance instead of silently dropping the code.
  }
}

export interface FormatVobsErrorOptions {
  readonly environment?: 'development' | 'production'
  readonly includeStack?: boolean
}

/** Format a concise, actionable message for terminals and dev overlays. */
export function formatVobsError(
  value: unknown,
  options: FormatVobsErrorOptions = {}
): string {
  const error = normalizeVobsError(value)
  const code = error.code || 'VOBS_UNKNOWN'
  const severity = error.severity || 'error'
  if (options.environment === 'production') return `[Vobs ${code}] ${error.message}`

  const lines = [`[Vobs ${capitalize(severity)}] ${error.message}`, `Code: ${code}`]
  if (error.location) lines.push(`Location: ${error.location.file}:${error.location.line}:${error.location.column}`)
  if (error.codeFrame) lines.push('', error.codeFrame)
  if (error.cause !== undefined) lines.push(`Cause: ${formatCause(error.cause)}`)
  if (error.trace?.length) lines.push('', `Trace: ${error.trace.join(' → ')}`)
  if (error.fix) lines.push('', `Fix: ${error.fix}`)
  if (error.example) lines.push('', `Example:\n${error.example}`)
  if (error.docs) lines.push(`Docs: ${error.docs}`)
  if (options.includeStack && error.stack) lines.push('', error.stack)
  return lines.join('\n')
}

function formatCause(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
