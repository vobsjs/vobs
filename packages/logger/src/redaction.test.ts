import { describe, expect, it } from 'vitest'
import { createLogger, createMemoryTransport } from './index'

/**
 * Reproduction of and regression against redaction "false security".
 *
 * Reproduction (measured before the fix, probes in the delivery notes): the
 * default table had only 6 keys compared by as-is lowercasing, so `apiKey` /
 * `access_token` / `refreshToken` / `clientSecret` / `set-cookie` / `sessionId`
 * **all landed in plaintext**; `message` and `Error.stack` were **not redacted
 * at all**; custom `redactKeys` **replaced** the default table (passing
 * `['userId']` made `password` / `token` plaintext instead).
 */
describe('@vobs/logger redaction', () => {
  it('default redaction table hits common key variants and leaves no plaintext in the whole entry', () => {
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
    // Not just key assertions: no sensitive plaintext may appear anywhere in the whole entry (including nesting)
    expect(JSON.stringify(memory.entries[0])).not.toContain('PLAINTEXT')
    logger.dispose()
  })

  it('sensitive values in message no longer land in plaintext (labeled form + context echo)', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    logger.warn('auth failed password=SUPERSECRET-777 token=TOKEN-888 authorization: Bearer BEARER-999')
    logger.warn('naked header Bearer NAKED-BEARER-000')
    // Values flagged as sensitive in the context echo back in the message
    logger.info('retrying with REFRESH-PLAINTEXT-333', { refreshToken: 'REFRESH-PLAINTEXT-333' })

    expect(memory.entries[0]?.message).toBe(
      'auth failed password=[REDACTED] token=[REDACTED] authorization: [REDACTED]'
    )
    expect(memory.entries[1]?.message).toBe('naked header Bearer [REDACTED]')
    expect(memory.entries[2]?.message).toBe('retrying with [REDACTED]')
    expect(memory.entries[2]?.context).toEqual({ refreshToken: '[REDACTED]' })
    logger.dispose()
  })

  it('Error.message / Error.stack go through the same redaction pipeline, independent of key order', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    const labelled = new Error('boom')
    labelled.stack = 'Error: boom\n    at dump (apiKey=STACKSECRET-999)'
    // This Error comes **before** the sensitive key: by-value scanning must run after context collection, otherwise the stack leaks
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

  it('custom redactKeys appends to the default table (not replaces); keys are case- and separator-insensitive', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory], redactKeys: ['userId'] })

    logger.info('custom', { userId: 'u-1', password: 'PWD-PLAINTEXT-000', token: 'TOK-PLAINTEXT-001' })
    logger.info('user_id: u-1')

    expect(memory.entries[0]?.context).toEqual({
      userId: '[REDACTED]',
      password: '[REDACTED]',
      token: '[REDACTED]'
    })
    // Custom keys participate in message text scanning as well
    expect(memory.entries[1]?.message).toBe('user_id: [REDACTED]')
    expect(JSON.stringify(memory.entries[0])).not.toContain('PLAINTEXT')
    logger.dispose()
  })

  it('ordinary text without sensitive labels stays untouched', () => {
    const memory = createMemoryTransport()
    const logger = createLogger({ transports: [memory] })

    logger.info('request finished in 12ms status=200', { status: 200, requestId: 'request-1' })

    expect(memory.entries[0]?.message).toBe('request finished in 12ms status=200')
    expect(memory.entries[0]?.context).toEqual({ status: 200, requestId: 'request-1' })
    logger.dispose()
  })

  it('a throwing getter on a sensitive key doesn\'t crash logging and the key is still redacted', () => {
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
