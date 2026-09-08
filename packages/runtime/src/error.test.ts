import { describe, expect, it } from 'vitest'
import { VobsError, formatVobsError, normalizeVobsError } from './error'

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
})
