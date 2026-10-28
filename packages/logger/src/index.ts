import { getCurrentOwner, onDispose } from '@vobs/reactivity'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogValue = string | number | boolean | null | Readonly<LogObject> | readonly LogValue[]

export interface LogObject {
  readonly [key: string]: LogValue
}

export type LogContext = Readonly<Record<string, unknown>>

export interface LogEntry {
  readonly timestamp: string
  readonly level: LogLevel
  readonly message: string
  readonly context: Readonly<LogObject>
}

export interface LogTransport {
  write(entry: LogEntry): void | PromiseLike<void>
  flush?(): void | PromiseLike<void>
  dispose?(): void
}

export interface Logger {
  readonly level: LogLevel
  log(level: LogLevel, message: string, context?: LogContext): void
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  child(context: LogContext): Logger
  flush(): Promise<void>
  dispose(): void
}

export interface LoggerOptions {
  readonly level?: LogLevel
  readonly context?: LogContext
  readonly transports?: readonly LogTransport[]
  /**
   * Extra key names **appended** to the default redaction table (not a
   * replacement for it).
   *
   * The original implementation replaced the table: passing
   * `redactKeys: ['userId']` made `password` / `token` land in plaintext —
   * callers who "just want to redact one more key" silently switched off all
   * default protection. The README always said "extendable via `redactKeys`",
   * so the behavior now follows the documented semantics: append.
   *
   * Key comparison ignores case and separators: `userId`, `user_id`, `user-id`,
   * `USER.ID` all hit the same rule; custom keys also participate in the text
   * scan of message / `Error.stack`.
   */
  readonly redactKeys?: readonly string[]
  readonly maxDepth?: number
  readonly clock?: () => Date
  readonly onTransportError?: (error: unknown, transport: LogTransport, entry?: LogEntry) => void
}

export interface LoggerPluginOptions extends LoggerOptions {
  readonly logger?: Logger
}

export interface ConsoleLike {
  debug?: (...data: unknown[]) => void
  info?: (...data: unknown[]) => void
  warn?: (...data: unknown[]) => void
  error?: (...data: unknown[]) => void
  log?: (...data: unknown[]) => void
}

export interface MemoryLogTransport extends LogTransport {
  readonly entries: readonly LogEntry[]
  clear(): void
}

export type LoggerErrorCode = 'LOGGER_CONTEXT_MISSING' | 'INVALID_LEVEL' | 'INVALID_TRANSPORT' | 'INVALID_MAX_DEPTH'

export class LoggerError extends Error {
  readonly code: LoggerErrorCode

  constructor(code: LoggerErrorCode, message: string) {
    super(message)
    this.name = 'LoggerError'
    this.code = code
  }
}

export const LOGGER_KEY: InjectionKey<Logger> = createInjectionKey<Logger>('vobs.logger')

const levels: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

/**
 * Default redaction key names.
 *
 * The original table had only 6 keys and compared them via `key.toLowerCase()`
 * as-is: verified that `apiKey` / `access_token` / `refreshToken` /
 * `clientSecret` / `set-cookie` / `sessionId` **all landed in plaintext** —
 * the default table gave the false security of "looks redacted". Key names are
 * now normalized first (see `normalizeRedactKey`), so `access_token` /
 * `accessToken` / `access-token` / `ACCESS_TOKEN` hit the same rule and listing
 * them in natural spelling here is enough.
 */
const defaultRedactKeys = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientSecret',
  'apiKey',
  'xApiKey',
  'accessKey',
  'accessKeyId',
  'privateKey',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'authToken',
  'authorization',
  'proxyAuthorization',
  'cookie',
  'setCookie',
  'session',
  'sessionId',
  'credential',
  'credentials'
]

interface RedactionPlan {
  /** Normalized sensitive key names; a key hit replaces the whole value with `[REDACTED]`. */
  readonly keys: ReadonlySet<string>
  /** `key=value` scanner for free text (message / `Error.stack`); derived from the same key set, so custom keys apply too. */
  readonly sensitiveText: RegExp
}

/** `Bearer xxx` / `Basic xxx`: authorization strings with no key name to rely on. */
const authorizationSchemePattern = /((?:bearer|basic)[ \t]+)([A-Za-z0-9._~+/=-]+)/gi

/**
 * Key-name normalization: case- and separator-insensitive.
 *
 * `apiKey`, `api_key`, `X-Api-Key` all normalize to `apikey`, avoiding one rule
 * per spelling variant.
 */
function normalizeRedactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Derives the free-text scanner from the key-name set.
 *
 * Each character of the normalized key is interleaved with `[ _-]?`, so the
 * `access_token` rule also matches `access token` / `accessToken` /
 * `access-token`. Single-character keys stay out of text scanning: matching
 * things like `x=1` would litter normal logs with `[REDACTED]`.
 */
function createRedactionPlan(extraKeys: readonly string[] | undefined): RedactionPlan {
  const keys = new Set([...defaultRedactKeys, ...(extraKeys ?? [])].map(normalizeRedactKey))
  const alternation = [...keys]
    .filter(key => key.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(key => key.split('').join('[ _-]?'))
    .join('|')
  return {
    keys,
    sensitiveText: alternation
      /*
       * Only consumes the labeled "key + separator + value" form; the value
       * contains no whitespace/comma/semicolon/quote/bracket. The value may be
       * preceded by an authorization scheme (`authorization: Bearer xxx`):
       * otherwise the key rule would only eat the word `Bearer` and the actual
       * token would remain in plaintext after it.
       */
      ? new RegExp(
          `(^|[^A-Za-z0-9])((?:${alternation})[ \\t]*[=:][ \\t]*)((?:(?:bearer|basic)[ \\t]+)?[^\\s,;)\\]}"']+)`,
          'gi'
        )
      // Never matches when there are no usable keys
      : /$^/
  }
}

interface LoggerState {
  readonly level: LogLevel
  readonly transports: readonly LogTransport[]
  readonly redaction: RedactionPlan
  readonly maxDepth: number
  readonly clock: () => Date
  readonly onTransportError: LoggerOptions['onTransportError']
  readonly pending: Set<Promise<void>>
  disposed: boolean
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  if (!isLogLevel(level)) throw new LoggerError('INVALID_LEVEL', `Vobs Logger: unsupported log level ${String(level)}`)

  const maxDepth = options.maxDepth ?? 8
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new LoggerError('INVALID_MAX_DEPTH', 'Vobs Logger: maxDepth must be an integer greater than or equal to 0')
  }

  const transports = options.transports ?? [createConsoleTransport()]
  if (transports.some(transport => !transport || typeof transport.write !== 'function')) {
    throw new LoggerError('INVALID_TRANSPORT', 'Vobs Logger: transport must provide write(entry)')
  }

  const state: LoggerState = {
    level,
    transports,
    redaction: createRedactionPlan(options.redactKeys),
    maxDepth,
    clock: options.clock ?? (() => new Date()),
    onTransportError: options.onTransportError,
    pending: new Set(),
    disposed: false
  }
  const logger = createLoggerScope(state, options.context ?? {}, true)
  if (getCurrentOwner()) onDispose(logger.dispose)
  return logger
}

export function createConsoleTransport(target: ConsoleLike | undefined = globalThis.console): LogTransport {
  return {
    write(entry): void {
      const output = target?.[entry.level] ?? target?.log
      output?.call(target, `[${entry.level}] ${entry.message}`, entry.context)
    }
  }
}

export function createMemoryTransport(limit = Infinity): MemoryLogTransport {
  if ((!Number.isInteger(limit) && limit !== Infinity) || limit <= 0) {
    throw new RangeError('Vobs Logger: memory transport limit must be a positive integer or Infinity')
  }

  const entries: LogEntry[] = []
  return {
    get entries(): readonly LogEntry[] {
      return entries
    },
    write(entry): void {
      entries.push(entry)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
    },
    clear(): void {
      entries.length = 0
    }
  }
}

export function loggerPlugin(options: LoggerPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/logger',
    version: '0.1.0',
    install(context) {
      const ownedLogger = options.logger ? undefined : createLogger(options)
      context.provide(LOGGER_KEY, options.logger ?? ownedLogger!)
      return () => ownedLogger?.dispose()
    }
  }
}

export function useLogger(): Logger {
  const logger = inject(LOGGER_KEY)
  if (!logger) throw new LoggerError('LOGGER_CONTEXT_MISSING', 'Vobs Logger: context not found; install loggerPlugin first')
  return logger
}

function createLoggerScope(state: LoggerState, baseContext: LogContext, ownsTransports = false): Logger {
  const context = { ...baseContext }
  let disposed = false

  /*
   * The four convenience methods used to be object-literal shorthands calling
   * `this.log(...)`: **destructuring broke them** — `const { info } = logger;
   * info('x')` threw `TypeError: Cannot read properties of undefined (reading
   * 'log')`. Logger objects get passed around like that all the time (`const
   * log = logger.info` and friends), so the implementation lives in closure
   * functions and every method is an arrow property (`state.set` in this repo
   * is an arrow function for the same reason).
   */
  const logEntry = (level: LogLevel, message: string, details: LogContext = {}): void => {
    if (state.disposed || disposed || !isLogLevel(level) || levels[level] < levels[state.level]) return
    const timestamp = safeTimestamp(state)
    /*
     * The order matters: sanitize the context first, and while at it collect
     * "which literal values in this log entry are sensitive", so message /
     * `Error.stack` can then be re-scanned against the same values
     * (previously neither was redacted at all).
     */
    const secrets = new Set<string>()
    const sanitized = sanitizeContext(safeMergeContext(context, details), state.redaction, state.maxDepth, secrets)
    const entry = freezeEntry({
      timestamp,
      level,
      message: typeof message === 'string' ? redactText(message, state.redaction, secrets) : message,
      context: redactContext(sanitized, state.redaction, secrets)
    })
    for (const transport of state.transports) writeToTransport(state, transport, entry)
  }

  return {
    level: state.level,

    log: logEntry,

    debug: (message, details) => logEntry('debug', message, details),

    info: (message, details) => logEntry('info', message, details),

    warn: (message, details) => logEntry('warn', message, details),

    error: (message, details) => logEntry('error', message, details),

    child(details): Logger {
      return createLoggerScope(state, { ...context, ...details })
    },

    async flush(): Promise<void> {
      while (state.pending.size > 0) await Promise.all([...state.pending])
      for (const transport of state.transports) {
        try {
          await transport.flush?.()
        } catch (error) {
          reportTransportError(state, error, transport)
        }
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      if (!ownsTransports || state.disposed) return
      state.disposed = true
      for (const transport of state.transports) {
        try {
          transport.dispose?.()
        } catch (error) {
          reportTransportError(state, error, transport)
        }
      }
    }
  }
}

function writeToTransport(state: LoggerState, transport: LogTransport, entry: LogEntry): void {
  try {
    const result = transport.write(entry)
    if (!isPromiseLike(result)) return
    const pending = Promise.resolve(result).catch(error => {
      reportTransportError(state, error, transport, entry)
    })
    state.pending.add(pending)
    void pending.then(() => state.pending.delete(pending))
  } catch (error) {
    reportTransportError(state, error, transport, entry)
  }
}

function reportTransportError(
  state: LoggerState,
  error: unknown,
  transport: LogTransport,
  entry?: LogEntry
): void {
  try {
    state.onTransportError?.(error, transport, entry)
  } catch {
    // Transport error reporting must never make application logging throw.
  }
}

function sanitizeContext(
  input: LogContext,
  plan: RedactionPlan,
  maxDepth: number,
  secrets: Set<string>
): LogObject {
  const seen = new WeakSet<object>()
  return Object.freeze(sanitizeObject(input, plan, maxDepth, seen, secrets))
}

/**
 * A broken clock (returns an invalid Date or throws) must not crash "writing a
 * log entry" itself. Verified: `state.clock().toISOString()` used to throw
 * `RangeError: Invalid time value` and zero log entries landed.
 */
function safeTimestamp(state: LoggerState): string {
  try {
    const now = state.clock()
    return Number.isNaN(now.getTime()) ? 'Invalid Date' : now.toISOString()
  } catch {
    return 'Invalid Date'
  }
}

/**
 * `{...details}` **reads getters**: a throwing getter made `log()` throw. Bad
 * data only takes out its own layer and must not drag down the whole entry
 * (`context` is an object this module built itself, so spreading it is safe).
 */
function safeMergeContext(base: LogContext, details: LogContext): LogContext {
  try {
    return { ...base, ...details }
  } catch (error) {
    return { ...base, '[Uninspectable]': toErrorMessage(error) }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

function sanitizeObject(
  input: LogContext,
  plan: RedactionPlan,
  depth: number,
  seen: WeakSet<object>,
  secrets: Set<string>
): LogObject {
  const output: Record<string, LogValue> = {}
  let keys: string[]
  try {
    // Not Object.entries: it reads all values at once, and a single throwing getter would take the whole layer down.
    keys = Object.keys(input)
  } catch (error) {
    // ownKeys / getOwnPropertyDescriptor traps of a malicious Proxy throw here
    return Object.freeze({ '[Uninspectable]': toErrorMessage(error) })
  }
  for (const key of keys) {
    if (plan.keys.has(normalizeRedactKey(key))) {
      output[key] = '[REDACTED]'
      collectSecret(input, key, secrets)
      continue
    }
    try {
      output[key] = sanitizeValue(input[key], plan, depth, seen, secrets)
    } catch (error) {
      // A throwing getter only takes out its own key; neighboring good keys log as usual
      output[key] = `[Uninspectable: ${toErrorMessage(error)}]`
    }
  }
  return Object.freeze(output)
}

/**
 * Records the literal values of redacted keys so message / `Error.stack` /
 * other free text can be re-scanned by value.
 *
 * The values of redacted keys used to be **never read**; now one extra getter
 * read is needed to get the value: a throw only excludes this value from text
 * scanning and must not make the whole log entry disappear (the basic
 * principle of this module: bad data only takes out itself).
 */
function collectSecret(input: LogContext, key: string, secrets: Set<string>): void {
  try {
    const value = input[key]
    if (typeof value === 'string') {
      if (value.length > 0 && value !== '[REDACTED]') secrets.add(value)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      secrets.add(String(value))
    } else if (typeof value === 'bigint') {
      secrets.add(String(value))
    }
  } catch {
    // Throwing getter: this key's value stays out of text scanning
  }
}

/**
 * Free-text redaction (message and `Error.stack` used to be left completely
 * untouched).
 *
 * Two verified leaks: `logger.info('login failed password=hunter2')` landed
 * entirely in plaintext; in `logger.error('threw', { err })` an `err.stack`
 * like `at dump (apiKey=STACKSECRET)` also landed in plaintext. This does two
 * things:
 * 1) **By value**: literal values flagged as sensitive in the context get
 *    replaced wherever they reappear in any text — the same token echoed in the
 *    message, or the same apiKey carried out in a stack, both get erased;
 * 2) **By key**: labeled forms like `password=...` / `access_token: ...` /
 *    `Bearer ...` — the key table is shared with key redaction (custom
 *    `redactKeys` applies in both places, so the two semantics can't drift).
 */
function redactText(text: string, plan: RedactionPlan, secrets: ReadonlySet<string>): string {
  let output = text
  for (const secret of secrets) {
    // Too-short "sensitive values" (e.g. the number 1, a one-character password) would mangle normal text; only replace identifiable lengths
    if (secret.length >= 4 && output.includes(secret)) output = output.split(secret).join('[REDACTED]')
  }
  // Scan by key first (the value may carry a `Bearer` prefix, eaten in one pass), then fall back to bare `Bearer xxx` without a key name
  return output.replace(plan.sensitiveText, '$1$2[REDACTED]').replace(authorizationSchemePattern, '$1[REDACTED]')
}

/**
 * Replays text redaction over the whole **already-sanitized** context tree.
 *
 * Running it after sanitization is deliberate: by then every getter / Proxy
 * has been read into plain data, so this pass only walks our own frozen
 * objects and cannot throw; and `secrets` is complete by then, so
 * `Error.stack` doesn't miss a sensitive key just because it came later.
 */
function redactContext(context: LogObject, plan: RedactionPlan, secrets: ReadonlySet<string>): LogObject {
  // LogObject values are all LogValue and redactDeep returns objects as-is in the object branch; this just narrows the union type
  return redactDeep(context, plan, secrets) as LogObject
}

function redactDeep(value: LogValue, plan: RedactionPlan, secrets: ReadonlySet<string>): LogValue {
  if (typeof value === 'string') return redactText(value, plan, secrets)
  if (Array.isArray(value)) return Object.freeze(value.map(item => redactDeep(item, plan, secrets)))
  if (value !== null && typeof value === 'object') {
    const output: Record<string, LogValue> = {}
    for (const key of Object.keys(value)) {
      output[key] = redactDeep((value as LogObject)[key], plan, secrets)
    }
    return Object.freeze(output)
  }
  return value
}

function sanitizeValue(
  value: unknown,
  plan: RedactionPlan,
  depth: number,
  seen: WeakSet<object>,
  secrets: Set<string>
): LogValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'undefined') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof Error) {
    return Object.freeze({
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {})
    })
  }
  if (depth === 0) return '[MaxDepth]'
  if (seen.has(value as object)) return '[Circular]'
  seen.add(value as object)
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => sanitizeValue(item, plan, depth - 1, seen, secrets)))
  }
  return sanitizeObject(value as LogContext, plan, depth - 1, seen, secrets)
}

function freezeEntry(entry: LogEntry): LogEntry {
  return Object.freeze(entry)
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return Boolean(value) && typeof (value as PromiseLike<void>).then === 'function'
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in levels
}
