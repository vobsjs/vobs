import { describe, expect, it, vi } from 'vitest'
import { createText, createVobs } from '@vobs/vobs'
import {
  LOGGER_KEY,
  LoggerError,
  createConsoleTransport,
  createLogger,
  createMemoryTransport,
  loggerPlugin,
  useLogger
} from './index'

describe('@vobs/logger', () => {
  /*
   * Writing a log entry must **never crash itself**: throwing getters in
   * caller data, malicious Proxy traps, and a broken clock could all make
   * `logger.info()` throw directly (0 entries landed). Mirrors the devtools
   * approach in the same position (try/catch → marker).
   */
  /*
   * Logger objects get destructured / passed as callbacks all the time
   * (`const { info } = logger`). The four convenience methods used to be
   * object-literal shorthands calling `this.log(...)` → after destructuring
   * `this` was undefined and it threw TypeError. `state.set` in this repo is
   * an arrow function for the same reason.
   */
  it('methods are safe to destructure (no longer rely on this)', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ level: 'debug', transports: [memory] })
    const { log, debug, info, warn, error } = logger

    expect(() => {
      log('debug', 'via log')
      debug('via debug')
      info('via info')
      warn('via warn')
      error('via error')
    }).not.toThrow()

    expect(memory.entries.map(entry => `${entry.level}:${entry.message}`)).toEqual([
      'debug:via log',
      'debug:via debug',
      'info:via info',
      'warn:via warn',
      'error:via error'
    ])
    // Also passed as a callback (map/forEach bind this to undefined or some other object)
    const levels = ['info', 'warn']
    const asCallback: (value: string) => void = logger.info
    levels.forEach(asCallback)
    expect(memory.entries).toHaveLength(7)
    logger.dispose()
  })

  it('throwing caller data / hostile Proxy / broken clock never crash logging itself', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({
      level: 'debug',
      transports: [memory],
      clock: () => new Date(Number.NaN)
    })

    const throwingGetter = { ok: 1, get boom(): string { throw new Error('getter exploded') } }
    const hostile = new Proxy({}, {
      ownKeys(): string[] { throw new Error('ownKeys exploded') },
      getOwnPropertyDescriptor(): PropertyDescriptor | undefined { throw new Error('descriptor exploded') }
    })

    expect(() => logger.info('with throwing getter', { throwingGetter })).not.toThrow()
    expect(() => logger.info('with hostile proxy as details', hostile)).not.toThrow()
    expect(() => logger.info('with hostile proxy as value', { hostile })).not.toThrow()
    expect(() => logger.info('with bad clock')).not.toThrow()

    expect(memory.entries).toHaveLength(4)
    // A broken clock must not make the whole entry disappear
    expect(memory.entries[3]?.timestamp).toBe('Invalid Date')
    // The throwing key only takes out itself; neighboring good keys log as usual
    const nested = memory.entries[0]?.context.throwingGetter as Record<string, unknown>
    expect(nested.ok).toBe(1)
    expect(String(nested.boom)).toContain('Uninspectable')
    // Proxy as the details object itself: spreading would crash → whole-object fallback, but the entry still logs
    expect(String(memory.entries[1]?.context['[Uninspectable]'])).toContain('ownKeys exploded')
    // Proxy as a value: the bad key only takes out itself
    const hostileValue = memory.entries[2]?.context.hostile as Record<string, unknown>
    expect(String(hostileValue['[Uninspectable]'])).toContain('ownKeys exploded')

    logger.dispose()
  })

  it('filters by level and merges structured child-logger context', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({
      level: 'info',
      context: { app: 'console', release: 3 },
      transports: [memory],
      clock: () => new Date('2026-09-03T00:00:00.000Z')
    })

    logger.debug('ignored')
    logger.child({ requestId: 'request-1' }).warn('request failed', { status: 503 })

    expect(memory.entries).toEqual([{
      timestamp: '2026-09-03T00:00:00.000Z',
      level: 'warn',
      message: 'request failed',
      context: { app: 'console', release: 3, requestId: 'request-1', status: 503 }
    }])
    expect(Object.isFrozen(memory.entries[0])).toBe(true)
    expect(Object.isFrozen(memory.entries[0].context)).toBe(true)
    logger.dispose()
  })

  it('redacts sensitive keys by default and safely handles errors, deep objects and circular values', () => {
    const memory = createMemoryTransport()
    const circular: { self?: unknown } = {}
    circular.self = circular
    const logger = createLogger({ transports: [memory], maxDepth: 2 })

    logger.error('login failed', {
      token: 'private',
      nested: { authorization: 'secret', value: true },
      error: new Error('denied'),
      circular,
      deep: { one: { two: { three: true } } }
    })

    expect(memory.entries[0].context).toMatchObject({
      token: '[REDACTED]',
      nested: { authorization: '[REDACTED]', value: true },
      error: { name: 'Error', message: 'denied' },
      circular: { self: '[Circular]' },
      deep: { one: { two: '[MaxDepth]' } }
    })
    logger.dispose()
  })

  it('flush awaits async transports and isolates transport write/flush errors', async () => {
    let resolveWrite: (() => void) | undefined
    const onTransportError = vi.fn()
    const asyncTransport = {
      write: vi.fn(() => new Promise<void>(resolve => { resolveWrite = resolve })),
      flush: vi.fn()
    }
    const brokenTransport = {
      write: () => { throw new Error('write failed') },
      flush: () => { throw new Error('flush failed') }
    }
    const logger = createLogger({ transports: [asyncTransport, brokenTransport], onTransportError })
    logger.info('queued')
    const flushed = logger.flush()
    expect(asyncTransport.flush).not.toHaveBeenCalled()
    resolveWrite?.()
    await flushed

    expect(asyncTransport.flush).toHaveBeenCalledTimes(1)
    expect(onTransportError).toHaveBeenCalledWith(expect.any(Error), brokenTransport, expect.objectContaining({ message: 'queued' }))
    expect(onTransportError).toHaveBeenCalledWith(expect.any(Error), brokenTransport, undefined)
    logger.dispose()
  })

  it('console transport outputs at the matching level; memory transport supports limit and clear', () => {
    const output = vi.fn()
    const consoleTransport = createConsoleTransport({ warn: output })
    const memory = createMemoryTransport(2)
    const logger = createLogger({ level: 'debug', transports: [consoleTransport, memory] })
    logger.warn('notice', { count: 1 })
    logger.info('first')
    logger.info('second')

    expect(output).toHaveBeenCalledWith('[warn] notice', { count: 1 })
    expect(memory.entries.map(entry => entry.message)).toEqual(['first', 'second'])
    memory.clear()
    expect(memory.entries).toEqual([])
    logger.dispose()
  })

  it('child logger disposal only stops its own writes, leaving the parent\'s shared transports open', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })
    const child = logger.child({ requestId: 'request-1' })

    child.dispose()
    child.info('ignored')
    logger.info('parent remains active')

    expect(memory.entries.map(entry => entry.message)).toEqual(['parent remains active'])
    logger.dispose()
  })

  it('loggerPlugin injects the context and stops writing its own logger after app destroy', () => {
    const memory = createMemoryTransport()
    let injected: ReturnType<typeof createLogger> | undefined
    const app = createVobs({
      render: () => createText('logger'),
      plugins: [
        loggerPlugin({ transports: [memory] }),
        { name: 'consumer', install(context) { injected = context.inject(LOGGER_KEY) } }
      ]
    })

    injected?.info('before destroy')
    app.destroy()
    injected?.info('after destroy')
    expect(memory.entries.map(entry => entry.message)).toEqual(['before destroy'])
  })

  it('useLogger gives a clear error when the plugin is not installed', () => {
    const app = createVobs({ render: () => {
      useLogger()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'LOGGER_CONTEXT_MISSING' })
    )
    expect(LoggerError).toBeDefined()
  })
})
