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
   * **追加**到默认脱敏表的额外键名（不是替换默认表）。
   *
   * 原实现是替换：传 `redactKeys: ['userId']` 之后 `password` / `token` 反而明文落地 ——
   * "只想多脱敏一个键"的调用方会静默关掉全部默认保护。README 一直写的是
   * "extendable via `redactKeys`"，这里按文档语义改成追加。
   *
   * 键名比较不区分大小写与分隔符：`userId`、`user_id`、`user-id`、`USER.ID` 命中同一条规则；
   * 自定义键名同时参与 message / `Error.stack` 的文本扫描。
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
 * 默认脱敏键名。
 *
 * 原来只有 6 个键、且按 `key.toLowerCase()` 原样比较：实测 `apiKey` / `access_token` /
 * `refreshToken` / `clientSecret` / `set-cookie` / `sessionId` **全部明文落地** ——
 * 默认表给的是"看起来脱敏"的假安全。现在键名先归一化（见 `normalizeRedactKey`），
 * `access_token` / `accessToken` / `access-token` / `ACCESS_TOKEN` 命中同一条规则，
 * 所以这里按自然写法列举即可。
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
  /** 归一化后的敏感键名；键名命中即整值替换为 `[REDACTED]`。 */
  readonly keys: ReadonlySet<string>
  /** 自由文本（message / `Error.stack`）里的 `key=value` 扫描器；由同一份键名派生，自定义键同样生效。 */
  readonly sensitiveText: RegExp
}

/** `Bearer xxx` / `Basic xxx`：没有键名可依的授权串。 */
const authorizationSchemePattern = /((?:bearer|basic)[ \t]+)([A-Za-z0-9._~+/=-]+)/gi

/**
 * 键名归一化：大小写与分隔符不敏感。
 *
 * `apiKey`、`api_key`、`X-Api-Key` 归一化后都是 `apikey`，避免为每种写法各补一条规则。
 */
function normalizeRedactKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * 由键名集合派生文本扫描器。
 *
 * 归一化后的键名逐字符插入 `[ _-]?`，所以 `access_token` 这条规则同时认 `access token` /
 * `accessToken` / `access-token`。单字符键名不进文本扫描：`x=1` 这类匹配会把普通日志打得到处是 `[REDACTED]`。
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
       * 只吃"键名 + 分隔符 + 值"这种带标签的写法；值里不含空白/逗号/分号/引号/括号。
       * 值前面允许跟一个授权方案（`authorization: Bearer xxx`）：否则键名规则只会吃掉 `Bearer` 这个词，
       * 真正的 token 反而留在后面明文落地。
       */
      ? new RegExp(
          `(^|[^A-Za-z0-9])((?:${alternation})[ \\t]*[=:][ \\t]*)((?:(?:bearer|basic)[ \\t]+)?[^\\s,;)\\]}"']+)`,
          'gi'
        )
      // 没有可用键名时永不匹配
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
  if (!isLogLevel(level)) throw new LoggerError('INVALID_LEVEL', `Vobs Logger: 不支持日志级别 ${String(level)}`)

  const maxDepth = options.maxDepth ?? 8
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new LoggerError('INVALID_MAX_DEPTH', 'Vobs Logger: maxDepth 必须是大于等于 0 的整数')
  }

  const transports = options.transports ?? [createConsoleTransport()]
  if (transports.some(transport => !transport || typeof transport.write !== 'function')) {
    throw new LoggerError('INVALID_TRANSPORT', 'Vobs Logger: transport 必须提供 write(entry)')
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
    throw new RangeError('Vobs Logger: memory transport 的 limit 必须是正整数或 Infinity')
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
  if (!logger) throw new LoggerError('LOGGER_CONTEXT_MISSING', 'Vobs Logger: 找不到上下文，请安装 loggerPlugin')
  return logger
}

function createLoggerScope(state: LoggerState, baseContext: LogContext, ownsTransports = false): Logger {
  const context = { ...baseContext }
  let disposed = false

  /*
   * 四个便捷方法原来是对象字面量简写 + `this.log(...)`：**解构即崩** ——
   * `const { info } = logger; info('x')` 抛 `TypeError: Cannot read properties of undefined (reading 'log')`。
   * 日志对象经常被这样传出去（`const log = logger.info` 之类），所以实现放成闭包函数、
   * 方法全部是箭头属性（本仓 `state.set` 出于同样理由做成箭头函数）。
   */
  const logEntry = (level: LogLevel, message: string, details: LogContext = {}): void => {
    if (state.disposed || disposed || !isLogLevel(level) || levels[level] < levels[state.level]) return
    const timestamp = safeTimestamp(state)
    /*
     * 顺序有讲究：上下文先净化，顺带收集"这次日志里哪些字面值属于敏感值"，
     * message / `Error.stack` 才能按同一份值再扫一遍（原来二者一个字都不脱敏）。
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
 * 坏 clock（返回无效 Date 或直接抛）不能让"记日志"本身崩。
 * 实测原来 `state.clock().toISOString()` 抛 `RangeError: Invalid time value`，整条日志 0 条落地。
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
 * `{...details}` 会**读取 getter**：抛错的 getter 会让 `log()` 直接抛。坏数据只顶掉自己那一层，
 * 不能连累整条日志（`context` 是本模块自己构造的对象，展开它是安全的）。
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
    // 不用 Object.entries：它一次性读全部值，任何一个抛错的 getter 会带走整层。
    keys = Object.keys(input)
  } catch (error) {
    // 恶意 Proxy 的 ownKeys / getOwnPropertyDescriptor 陷阱会在这里抛
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
      // 抛错的 getter 只顶掉自己这一个键，相邻的好键照常记录
      output[key] = `[Uninspectable: ${toErrorMessage(error)}]`
    }
  }
  return Object.freeze(output)
}

/**
 * 记下被脱敏键的字面值，供 message / `Error.stack` / 其它自由文本按值再扫一遍。
 *
 * 原来脱敏键的值**根本不读**，现在为了拿值要新读一次 getter：抛错只让这个值不参与文本扫描，
 * 不能让整条日志消失（本模块的基本原则：坏数据只顶掉自己）。
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
    // 抛错的 getter：这个键的值不参与文本扫描
  }
}

/**
 * 自由文本脱敏（message 与 `Error.stack` 原来一个字都不脱敏）。
 *
 * 实测两处泄漏：`logger.info('login failed password=hunter2')` 整条明文落地；
 * `logger.error('threw', { err })` 里 `err.stack` 形如 `at dump (apiKey=STACKSECRET)` 也明文落地。
 * 这里做两件事：
 * 1) **按值**替换：上下文里被判为敏感的字面值，在任何文本中再次出现即替换 ——
 *    message 里回显同一个 token、或堆栈里带出同一个 apiKey，都会被抹掉；
 * 2) **按键**扫描：`password=...` / `access_token: ...` / `Bearer ...` 这类带标签的写法，
 *    键名表与键脱敏共用一份（自定义 `redactKeys` 同样生效，两处语义不会漂移）。
 */
function redactText(text: string, plan: RedactionPlan, secrets: ReadonlySet<string>): string {
  let output = text
  for (const secret of secrets) {
    // 太短的"敏感值"（比如数字 1、单字符口令）会把正常文本打烂，只替换有辨识度的长度
    if (secret.length >= 4 && output.includes(secret)) output = output.split(secret).join('[REDACTED]')
  }
  // 先按键扫（值里允许带 `Bearer` 前缀，一次吃干净），再兜底没有键名的裸 `Bearer xxx`
  return output.replace(plan.sensitiveText, '$1$2[REDACTED]').replace(authorizationSchemePattern, '$1[REDACTED]')
}

/**
 * 对**已净化**的上下文整棵树重放文本脱敏。
 *
 * 放在净化之后是刻意的：那时所有 getter / Proxy 都已经被读成普通数据，这一遍只走自己的冻结对象，
 * 不可能抛；而且此时 `secrets` 已经收全，`Error.stack` 不会因为"敏感键排在后面"而漏掉。
 */
function redactContext(context: LogObject, plan: RedactionPlan, secrets: ReadonlySet<string>): LogObject {
  // LogObject 的值都是 LogValue，redactDeep 在对象分支原样返回对象；这里只是把联合类型收窄
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
