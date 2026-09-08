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
  it('按级别过滤，并合并子日志的结构化上下文', () => {
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

  it('默认脱敏敏感键，安全处理错误、深层对象和循环值', () => {
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

  it('flush 等待异步 transport，并隔离 transport 写入和 flush 错误', async () => {
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

  it('console transport 使用对应级别输出，内存 transport 可以限制和清空', () => {
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

  it('子 Logger 销毁只停止自己的写入，不关闭父 Logger 的共享 transport', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })
    const child = logger.child({ requestId: 'request-1' })

    child.dispose()
    child.info('ignored')
    logger.info('parent remains active')

    expect(memory.entries.map(entry => entry.message)).toEqual(['parent remains active'])
    logger.dispose()
  })

  it('loggerPlugin 注入上下文并在应用销毁后停止写入自有 logger', () => {
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

  it('未安装插件时 useLogger 给出明确错误', () => {
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
