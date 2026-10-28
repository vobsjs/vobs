/*
 * `vobs explain` — queryable explanations for diagnostic codes (Rust's `rustc --explain` pattern).
 *
 * ## Why it is needed
 *
 * The C104–C108 rules in this round are only knowable by **reading the source**; an AI
 * sees just the one error line. The Rust ecosystem is considered "unfriendly to humans
 * but AI-friendly" largely because its rules **can be queried, not guessed**.
 *
 * ## The three behaviors to lock in
 *
 * 1. **Every entry answers four questions** (what / why / correct / counter-example) —
 *    missing one regresses into "just a single error line"
 * 2. **No entry means no invention** — say plainly that it is missing and list the covered
 *    codes. Guessed documentation is worse than none
 * 3. **Gaps stay visible** — `--missing` lists codes that exist in the source but have no
 *    entry, instead of implying "the framework only has these codes"
 */
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_GUIDES, findDiagnosticGuide } from '@vobs/runtime'

describe('diagnostic guide registry', () => {
  it('every entry answers the four questions (missing one regresses into "just a single error line")', () => {
    for (const guide of DIAGNOSTIC_GUIDES) {
      expect(guide.title.trim(), `${guide.code} missing title`).not.toBe('')
      expect(guide.why.trim(), `${guide.code} missing why (why it happens)`).not.toBe('')
      expect(guide.correct.trim(), `${guide.code} missing correct (the correct form)`).not.toBe('')
      expect(guide.wrong.trim(), `${guide.code} missing wrong (counter-example)`).not.toBe('')
    }
  })

  it('codes are unique and well-formed', () => {
    const codes = DIAGNOSTIC_GUIDES.map(item => item.code)
    expect(new Set(codes).size, 'duplicate codes found').toBe(codes.length)
    for (const code of codes) expect(code, `${code} is malformed`).toMatch(/^VOBS_C\d{3}$/u)
  })

  it('severity is only error / warning', () => {
    for (const guide of DIAGNOSTIC_GUIDES) {
      expect(['error', 'warning']).toContain(guide.severity)
    }
  })

  it('**covers every diagnostic landed this round** (one miss makes that rule unqueryable)', () => {
    const covered = new Set(DIAGNOSTIC_GUIDES.map(item => item.code))
    // All of these were actually added or changed in this round; they must be queryable
    for (const code of ['VOBS_C104', 'VOBS_C105', 'VOBS_C106', 'VOBS_C107', 'VOBS_C108', 'VOBS_C118', 'VOBS_C120', 'VOBS_C210', 'VOBS_C211', 'VOBS_C232', 'VOBS_C233', 'VOBS_C234']) {
      expect(covered.has(code), `${code} has no explanation entry — it is unqueryable`).toBe(true)
    }
  })

  it('**explanations must point to the correct form** (error-only output is worthless to AI)', () => {
    // The C210 guide must teach the structure (on()) instead of only the patch (untrack)
    const guide = findDiagnosticGuide('VOBS_C210')!
    expect(guide.correct).toContain('on(')
    expect(guide.correct).toContain('untrack')
    // Order: on( appears before untrack (teach structure first, patch second)
    expect(guide.correct.indexOf('on(')).toBeLessThan(guide.correct.indexOf('untrack'))
  })

  it('unknown codes return undefined (callers must handle it explicitly; no inventing)', () => {
    expect(findDiagnosticGuide('VOBS_C999')).toBeUndefined()
  })
})
