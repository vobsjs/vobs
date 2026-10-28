/*
 * The **advice given by `vobs explain` must itself be valid** (P3).
 *
 * ## This round burned us twice
 *
 * 1. **C104's fix misled the styling pipeline**: it recommended `class={cond ? 'is-on' : 'is-off'}`,
 *    while the real project only had compound selectors (`.seq-param-group.is-off`) — following it verbatim yields
 *    "the class is applied but the styles never take effect".
 * 2. **C108's first fix was only half right**: it said "write it at the usage site", but testing showed that **only holds for JSX child positions**;
 *    turning it into a ternary at the component top-level `return` changes **"crashes" into "the UI never switches"** (more insidious).
 *
 * Both were found **by hand**. Therefore: **a diagnostic's fix text is code too, and must be verified.**
 *
 * ## Single source of truth for fixtures (since 2026-10-28)
 *
 * The before/after rewrite pairs are **no longer hand-written fixtures in this file** but the `DiagnosticGuide.rewrites`
 * metadata (diagnostic-guide.ts in @vobs/runtime) — passed through verbatim to AI by `vobs explain --json` and
 * `diagnostics.md`. This file does exactly one thing: **verify every rewrites entry** —
 * wrong must genuinely report the code, correct must produce zero diagnostics. Metadata and verification share one source, so they cannot drift.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'
import { analyzeSource } from './analyze'
import { DIAGNOSTIC_GUIDES } from '@vobs/runtime'

/** Which codes this source raises on the **static channel** (compiler + analyzer merged, matching vobs check). */
function codesOf(source: string): string[] {
  const compiled = compileWithSourceMap(source, { filename: 'a.tsx' }).diagnostics.map(item => item.code)
  const analyzed = analyzeSource(source, 'a.tsx').map(item => item.code)
  return [...new Set([...compiled, ...analyzed])]
}

describe('every rewrites entry must be valid (the metadata is the truth)', () => {
  for (const guide of DIAGNOSTIC_GUIDES) {
    for (const [index, pair] of (guide.rewrites ?? []).entries()) {
      it(`${guide.code}[${index}]: the wrong fixture must report the code`, () => {
        expect(codesOf(pair.wrong), `${guide.code}'s wrong fixture did not trigger it — this verification is empty`).toContain(guide.code)
      })

      it(`${guide.code}[${index}]: **zero diagnostics after rewriting per the advice**`, () => {
        const codes = codesOf(pair.correct)
        expect(codes, `${guide.code} still has diagnostics after the advised rewrite: ${codes.join(', ')} — that would walk users into another pit`).toEqual([])
      })
    }
  }

  it('**key diagnostic codes all carry rewrites** (missing one = the AI gets the code but no rewrite instructions)', () => {
    const required = ['VOBS_C104', 'VOBS_C105', 'VOBS_C106', 'VOBS_C107', 'VOBS_C108',
      'VOBS_C118', 'VOBS_C120', 'VOBS_C210', 'VOBS_C232', 'VOBS_C233', 'VOBS_C234']
    for (const code of required) {
      const guide = DIAGNOSTIC_GUIDES.find(item => item.code === code)
      expect(guide?.rewrites?.length ?? 0, `${code} has no rewrites — the AI only gets a description, no directly replaceable before/after`).toBeGreaterThan(0)
    }
  })
})
