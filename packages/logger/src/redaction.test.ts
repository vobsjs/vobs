import { describe, expect, it } from 'vitest'
import { createLogger, createMemoryTransport } from './index'

/**
 * 脱敏的"假安全"复现与回归。
 *
 * 复现（改动前实测，探针见交付说明）：默认表只有 6 个键且按原样小写比较，于是
 * `apiKey` / `access_token` / `refreshToken` / `clientSecret` / `set-cookie` / `sessionId`
 * **全部明文落地**；`message` 与 `Error.stack` **一个字都不脱敏**；
 * 自定义 `redactKeys` 是**替换**默认表（传 `['userId']` 之后 `password` / `token` 反而明文）。
 */
describe('@vobs/logger 脱敏', () => {
  it('默认脱敏表命中常见变体键名，且整条日志不留明文', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    logger.error('login failed', {
      apiKey: 'AKIA-PLAINTEXT-111',
      access_token: 'ACCESS-PLAINTEXT-222',
      refreshToken: 'REFRESH-PLAINTEXT-333',
      clientSecret: 'CLIENTSECRET-PLAINTEXT-444',
      'set-cookie': 'session=SETCOOKIE-PLAINTEXT-555',
      sessionId: 'SESSIONID-PLAINTEXT-666',
      requestId: 'request-1'
    })

    expect(memory.entries[0]?.context).toEqual({
      apiKey: '[REDACTED]',
      access_token: '[REDACTED]',
      refreshToken: '[REDACTED]',
      clientSecret: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      sessionId: '[REDACTED]',
      requestId: 'request-1'
    })
    // 不只断言键：整条日志（含嵌套）里都不许出现敏感值的明文
    expect(JSON.stringify(memory.entries[0])).not.toContain('PLAINTEXT')
    logger.dispose()
  })

  it('message 里的敏感值不再明文落地（带键名的写法 + 上下文回显）', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    logger.warn('auth failed password=SUPERSECRET-777 token=TOKEN-888 authorization: Bearer BEARER-999')
    logger.warn('naked header Bearer NAKED-BEARER-000')
    // 上下文里被判为敏感的值，在 message 里回显
    logger.info('retrying with REFRESH-PLAINTEXT-333', { refreshToken: 'REFRESH-PLAINTEXT-333' })

    expect(memory.entries[0]?.message).toBe(
      'auth failed password=[REDACTED] token=[REDACTED] authorization: [REDACTED]'
    )
    expect(memory.entries[1]?.message).toBe('naked header Bearer [REDACTED]')
    expect(memory.entries[2]?.message).toBe('retrying with [REDACTED]')
    expect(memory.entries[2]?.context).toEqual({ refreshToken: '[REDACTED]' })
    logger.dispose()
  })

  it('Error.message / Error.stack 走同一条脱敏管道，且不受键顺序影响', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    const labelled = new Error('boom')
    labelled.stack = 'Error: boom\n    at dump (apiKey=STACKSECRET-999)'
    // 这个 Error 排在敏感键**前面**：按值扫描必须等上下文收集完再跑，否则 stack 会漏
    const echoed = new Error('failed for token ECHO-SECRET-111')
    echoed.stack = 'Error: failed for token ECHO-SECRET-111\n    at run'

    logger.error('threw', { echoed, apiKey: 'ECHO-SECRET-111', labelled })

    expect(memory.entries[0]?.context).toEqual({
      labelled: {
        name: 'Error',
        message: 'boom',
        stack: 'Error: boom\n    at dump (apiKey=[REDACTED])'
      },
      echoed: {
        name: 'Error',
        message: 'failed for token [REDACTED]',
        stack: 'Error: failed for token [REDACTED]\n    at run'
      },
      apiKey: '[REDACTED]'
    })
    expect(JSON.stringify(memory.entries[0])).not.toContain('SECRET-')
    logger.dispose()
  })

  it('自定义 redactKeys 是追加默认表（不是替换），键名不区分大小写与分隔符', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory], redactKeys: ['userId'] })

    logger.info('custom', { userId: 'u-1', password: 'PWD-PLAINTEXT-000', token: 'TOK-PLAINTEXT-001' })
    logger.info('user_id: u-1')

    expect(memory.entries[0]?.context).toEqual({
      userId: '[REDACTED]',
      password: '[REDACTED]',
      token: '[REDACTED]'
    })
    // 自定义键同样参与 message 的文本扫描
    expect(memory.entries[1]?.message).toBe('user_id: [REDACTED]')
    expect(JSON.stringify(memory.entries[0])).not.toContain('PLAINTEXT')
    logger.dispose()
  })

  it('不带敏感标签的普通文本保持原样', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    logger.info('request finished in 12ms status=200', { status: 200, requestId: 'request-1' })

    expect(memory.entries[0]?.message).toBe('request finished in 12ms status=200')
    expect(memory.entries[0]?.context).toEqual({ status: 200, requestId: 'request-1' })
    logger.dispose()
  })

  it('敏感键上的抛错 getter 不让日志崩，该键仍然脱敏', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })
    const hostile = {
      get password(): string {
        throw new Error('secret getter exploded')
      },
      ok: 1
    }

    expect(() => logger.info('hostile secret key', { hostile })).not.toThrow()

    expect(memory.entries[0]?.context).toEqual({ hostile: { password: '[REDACTED]', ok: 1 } })
    logger.dispose()
  })
})
