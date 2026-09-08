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

export function isVobsError(value: unknown): value is VobsError {
  return value instanceof VobsError
    || Boolean(value && typeof value === 'object'
      && typeof (value as { code?: unknown }).code === 'string'
      && typeof (value as { message?: unknown }).message === 'string'
      && typeof (value as { layer?: unknown }).layer === 'string')
}

/** Convert thrown strings and third-party errors without losing their message. */
export function normalizeVobsError(value: unknown, defaults: VobsErrorDefaults = {}): VobsError {
  if (value instanceof VobsError) return value
  if (value instanceof Error) {
    // Preserve the original Error identity so boundaries and DevTools can
    // correlate event/effect phases without creating duplicate diagnostics.
    const metadata = value as Error & {
      readonly vobsCode?: unknown
      readonly vobsHint?: unknown
      readonly vobsSource?: unknown
    }
    const code = defaults.code ?? (typeof metadata.vobsCode === 'string' ? metadata.vobsCode : undefined)
    if (code) defineErrorMetadata(value, 'code', code)
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
  if (isVobsError(value)) {
    const candidate = value as VobsErrorOptions & { severity?: VobsErrorSeverity; layer?: VobsErrorLayer }
    return new VobsError({
      code: candidate.code,
      message: candidate.message,
      severity: candidate.severity ?? defaults.severity,
      layer: candidate.layer ?? defaults.layer,
      cause: candidate.cause,
      fix: candidate.fix ?? defaults.fix,
      location: candidate.location,
      trace: candidate.trace,
      example: candidate.example,
      docs: candidate.docs,
      codeFrame: candidate.codeFrame
    })
  }
  const message = String(value)
  return new VobsError({
    code: defaults.code ?? 'VOBS_UNKNOWN',
    message,
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
    // Frozen third-party errors still retain their original message and stack.
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
