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
 * 结构化识别（不依赖 `instanceof`）。
 *
 * **不能要求 `layer` 也齐全** —— 原来要求 code + message + layer 三者都是字符串，
 * 于是调用方递一个 `{ code, message }` 就会被判为「不是 VobsError」，掉进最后的
 * `String(value)` 兜底，输出 `[object Object]`：诊断系统自己把诊断丢了。
 * layer 缺失在下面构造时会补上默认值，没有理由在识别阶段就否掉。
 */
export function isVobsError(value: unknown): value is VobsError {
  return value instanceof VobsError
    || Boolean(value && typeof value === 'object'
      && typeof (value as { code?: unknown }).code === 'string'
      && typeof (value as { message?: unknown }).message === 'string')
}

/**
 * 别的打包副本造的 VobsError。
 *
 * tsup `splitting: false` 让 error.ts 同时进 `dist/index.js` 与 `dist/error.js`，
 * 两份类互不 `instanceof`。字段齐全，只是身份不同 —— 识别出来复制成本地实例。
 */
function isForeignVobsError(value: unknown): value is Error & VobsErrorOptions {
  return value instanceof Error
    && value.name === 'VobsError'
    && typeof (value as { code?: unknown }).code === 'string'
}

/** 兜底取消息：至少要能读出对象上的 message，别再输出 `[object Object]`。 */
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

/** 把任意来源的「类 VobsError」字段复制成本地实例。 */
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
  // 本地实例：原样返回，保持同一性与已有 stack
  if (value instanceof VobsError) return value

  // 别的副本造的：复制成本地实例，下游 instanceof 才成立
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
       * 冻结 / 不可扩展的第三方 Error 上挂不上元数据。原来这里静默吞掉，
       * 于是 normalize 的结果 code 是 undefined（打印成 VOBS_UNKNOWN）。
       * 挂不上就复制成本地实例，别把 code 丢了。
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

  // 结构化对象（可能缺 layer，甚至缺 severity）：补齐后构造成本地 VobsError
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
    // 冻结 / 不可扩展的第三方 Error：元数据挂不上。调用方会用「写完再读回」判断
    // 是否成功，失败时改成复制成本地实例，而不是静默丢掉 code。
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
