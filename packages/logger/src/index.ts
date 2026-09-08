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

const defaultRedactKeys = ['password', 'passwd', 'secret', 'token', 'authorization', 'cookie']

interface LoggerState {
  readonly level: LogLevel
  readonly transports: readonly LogTransport[]
  readonly redactKeys: ReadonlySet<string>
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
    redactKeys: new Set((options.redactKeys ?? defaultRedactKeys).map(key => key.toLowerCase())),
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
  return {
    level: state.level,

    log(level, message, details = {}): void {
      if (state.disposed || disposed || !isLogLevel(level) || levels[level] < levels[state.level]) return
      const entry = freezeEntry({
        timestamp: state.clock().toISOString(),
        level,
        message,
        context: sanitizeContext({ ...context, ...details }, state.redactKeys, state.maxDepth)
      })
      for (const transport of state.transports) writeToTransport(state, transport, entry)
    },

    debug(message, details): void {
      this.log('debug', message, details)
    },

    info(message, details): void {
      this.log('info', message, details)
    },

    warn(message, details): void {
      this.log('warn', message, details)
    },

    error(message, details): void {
      this.log('error', message, details)
    },

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

function sanitizeContext(input: LogContext, redactKeys: ReadonlySet<string>, maxDepth: number): LogObject {
  const seen = new WeakSet<object>()
  return Object.freeze(sanitizeObject(input, redactKeys, maxDepth, seen))
}

function sanitizeObject(
  input: LogContext,
  redactKeys: ReadonlySet<string>,
  depth: number,
  seen: WeakSet<object>
): LogObject {
  const output: Record<string, LogValue> = {}
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactKeys.has(key.toLowerCase())
      ? '[REDACTED]'
      : sanitizeValue(value, redactKeys, depth, seen)
  }
  return Object.freeze(output)
}

function sanitizeValue(
  value: unknown,
  redactKeys: ReadonlySet<string>,
  depth: number,
  seen: WeakSet<object>
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
    return Object.freeze(value.map(item => sanitizeValue(item, redactKeys, depth - 1, seen)))
  }
  return sanitizeObject(value as LogContext, redactKeys, depth - 1, seen)
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
