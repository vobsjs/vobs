import { describe, expect, it } from 'vitest'
import { VobsError, formatVobsError, isVobsError, normalizeVobsError } from './error'

describe('Vobs error protocol', () => {
  it('normalizes unknown throws with a stable code', () => {
    const error = normalizeVobsError('offline', { code: 'VOBS_H001', layer: 'http' })
    expect(error).toBeInstanceOf(VobsError)
    expect(error.code).toBe('VOBS_H001')
    expect(error.layer).toBe('http')
    expect(error.message).toBe('offline')
  })

  it('formats actionable development and production output', () => {
    const error = new VobsError({
      code: 'VOBS_R001',
      message: 'Component render failed',
      cause: new TypeError('missing data'),
      fix: 'Guard the value before reading it.',
      location: { file: 'src/App.tsx', line: 4, column: 9 }
    })
    const output = formatVobsError(error)
    expect(output).toContain('Code: VOBS_R001')
    expect(output).toContain('Location: src/App.tsx:4:9')
    expect(output).toContain('Cause: TypeError: missing data')
    expect(output).toContain('Fix: Guard the value before reading it.')
    expect(formatVobsError(error, { environment: 'production' })).toBe('[Vobs VOBS_R001] Component render failed')
  })

  /*
   * The diagnostic system losing its own diagnostics — three spots, same story.
   * `isVobsError` requires code + message + layer all present, so a caller passing
   * `{ code, message }` was judged "not a VobsError", fell into the String(value)
   * fallback, printed `[object Object]`, and the message vanished entirely.
   */
  describe('message preservation', () => {
    it('structured object with code + message keeps the message', () => {
      const error = normalizeVobsError({ code: 'VOBS_H001', message: 'boom' })
      expect(error.message).toBe('boom')
      expect(error.message).not.toContain('[object')
      expect(error.code).toBe('VOBS_H001')
      expect(error.layer).toBe('runtime')
      expect(formatVobsError(error).split('\n')[0]).toBe('[Vobs Error] boom')
    })

    it('object with only message keeps the message too', () => {
      expect(normalizeVobsError({ message: 'just a message' }).message).toBe('just a message')
    })

    it('values that are neither Error nor message-y still yield readable content', () => {
      expect(normalizeVobsError({ some: 'object' }).message).toContain('object')
      expect(normalizeVobsError(null).message).toBe('null')
    })

    it('isVobsError does not require layer', () => {
      expect(isVobsError({ code: 'X', message: 'y' })).toBe(true)
      expect(isVobsError({ code: 'X' })).toBe(false)
      expect(isVobsError('not an error')).toBe(false)
    })
  })

  /*
   * tsup `splitting: false` puts error.ts into both dist/index.js and dist/error.js,
   * and the two classes are not instanceof each other. Instances passed across entry
   * points must be recognized and copied into local instances, otherwise downstream
   * instanceof checks and formatting both go wrong.
   */
  describe('cross-bundle-copy class identity', () => {
    it('structural recognition adopts foreign instances into local ones', () => {
      // Simulate "another copy": name and fields look like a VobsError but not instanceof the local class
      const foreign = Object.assign(new Error('from another bundle copy'), {
        name: 'VobsError',
        code: 'VOBS_F001',
        severity: 'error',
        layer: 'runtime'
      })
      expect(foreign).not.toBeInstanceOf(VobsError)

      const adopted = normalizeVobsError(foreign)
      expect(adopted).toBeInstanceOf(VobsError)
      expect(adopted.code).toBe('VOBS_F001')
      expect(adopted.message).toBe('from another bundle copy')
      expect(adopted.cause).toBe(foreign)
    })

    it('local instances return as-is; plain Errors keep identity', () => {
      const local = new VobsError({ code: 'VOBS_L', message: 'local' })
      expect(normalizeVobsError(local)).toBe(local)

      const plain = new TypeError('plain')
      const normalized = normalizeVobsError(plain, { code: 'VOBS_P' })
      expect(normalized).toBe(plain)
      expect((plain as { code?: string }).code).toBe('VOBS_P')
    })

    it('adopts into a local instance when metadata cannot attach to a frozen Error, instead of dropping the code', () => {
      const frozen = Object.freeze(new Error('frozen boom'))
      const normalized = normalizeVobsError(frozen, { code: 'VOBS_FROZEN' })

      expect(normalized.code).toBe('VOBS_FROZEN')
      expect(normalized.message).toBe('frozen boom')
      expect(normalized.cause).toBe(frozen)
    })
  })
})
