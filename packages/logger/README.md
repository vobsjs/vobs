# @vobs/logger

Structured, level-filtered logging with pluggable transports, context scoping, and default redaction.

## Install

```bash
npm install @vobs/logger
```

## Quick start

```ts
import { createLogger, createMemoryTransport } from '@vobs/logger'

const memory = createMemoryTransport(100)
const logger = createLogger({
  level: 'info',
  context: { app: 'console' },
  transports: [memory]
})

const request = logger.child({ requestId: 'request-1' })
request.warn('request failed', { status: 503 })
await logger.flush()
```

## API

| Signature | Description |
| --- | --- |
| `createLogger(options?: LoggerOptions): Logger` | Creates a logger; defaults to level `'info'` and a console transport. |
| `logger.level: LogLevel` | Minimum level: `'debug'`, `'info'`, `'warn'`, or `'error'`. |
| `logger.log(level, message, context?)` / `debug` / `info` / `warn` / `error` | Emit entries; below-level calls are dropped. |
| `logger.child(context: LogContext): Logger` | Returns a logger whose entries merge the parent and child context. |
| `logger.flush(): Promise<void>` | Waits for pending async writes, then calls `flush` on each transport. |
| `logger.dispose(): void` | Stops the logger; the root logger also disposes owned transports. |
| `createConsoleTransport(target?: ConsoleLike): LogTransport` | Writes `[level] message` plus context to a console-like target. |
| `createMemoryTransport(limit?): MemoryLogTransport` | Keeps entries in a ring buffer with `entries` and `clear()`. |
| `loggerPlugin(options?): VobsPlugin` | Provides the logger through `LOGGER_KEY`. |
| `useLogger(): Logger` | Injects the logger inside components. |

Context objects are sanitized before writing: sensitive keys (`password`, `token`, `authorization`, `cookie`, and more, extendable via `redactKeys`) become `[REDACTED]`, circular references become `[Circular]`, depth is capped by `maxDepth` (default 8), and `Error`/`Date` values are serialized. Transport write and flush failures are reported through `onTransportError` and never make logging throw.

## Types

`Logger`, `LogLevel`, `LogEntry`, `LogContext`, `LogObject`, `LogValue`, `LogTransport`, `ConsoleLike`, `MemoryLogTransport`, `LoggerOptions`, `LoggerPluginOptions`, `LoggerErrorCode`
