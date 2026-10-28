// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createI18n } from './index'

/*
 * registerFormatter's unregister handle must converge.
 *
 * Measured in a deep-read report: after register A → register B (same name),
 *   · unregistering A's handle → **deleted** B (the formatter degraded to String)
 *   · then unregistering B's handle → **brought A back**
 * A single `() => void` could achieve "never fully unregisters + resurrects a corpse".
 *
 * The fix is an identity check: roll back only when our own registration **is still the current
 * value**. Then the displaced registration's handle is a no-op (it indeed never took effect),
 * restoring the previous one when the later unregisters is correct, and calling the same handle
 * twice is idempotent.
 */
const fmt = (text: string) => (): string => text
const read = (i18n: ReturnType<typeof createI18n>): string => {
  const value = i18n.t('k', { v: 'x' })
  return value
}

describe('i18n registerFormatter unregister', () => {
  it('unregistering the displaced registration does not delete the later one', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const offA = i18n.registerFormatter('up', fmt('A'))
    const offB = i18n.registerFormatter('up', fmt('B'))
    expect(read(i18n)).toBe('B')

    offA()                                   // Key point: A has been displaced by B
    expect(read(i18n), 'unregistering A deleted the later B').toBe('B')

    offB()
    expect(read(i18n)).toBe('A')             // B unregistered → the previous one (A) is restored

    /*
     * Calling offA() again now **removes A** — that is correct, not a defect:
     * offA's semantics is "remove A if it is the current formatter", and after B unregistered, A
     * is indeed the current value again. I initially asserted here that "repeated unregistration
     * must not change state", which was an **incorrect expectation I invented myself** (it assumed
     * strict idempotence across state changes); stack semantics is inherently stateful.
     */
    offA()
    expect(read(i18n), 'A is the current value → unregistering now should remove it').not.toBe('A')
    i18n.dispose()
  })

  it('plain register/unregister still works cleanly (non-regression)', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const off = i18n.registerFormatter('up', fmt('ONLY'))
    expect(read(i18n)).toBe('ONLY')
    off()
    expect(read(i18n)).not.toBe('ONLY')       // After unregistering, the custom formatter no longer applies
    i18n.dispose()
  })

  it('both handles consumed in reverse order → fully cleared (no residue left)', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const offA = i18n.registerFormatter('up', fmt('A'))
    const offB = i18n.registerFormatter('up', fmt('B'))
    offB(); offA()
    expect(read(i18n)).not.toBe('A')
    expect(read(i18n)).not.toBe('B')
    i18n.dispose()
  })
})
