import { describe, expect, it } from 'vitest'
import { createId, createOwner } from './index'

describe('createId', () => {
  it('scopes counters to an owner root', () => {
    const first = createOwner()
    const second = createOwner()
    const a = first.run(() => createId('field'))
    const b = second.run(() => createId('field'))
    expect(a).toBe('field-1')
    expect(b).toBe('field-1')
    first.dispose()
    second.dispose()
  })
})
