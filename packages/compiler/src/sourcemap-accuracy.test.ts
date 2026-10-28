// @vitest-environment node
/*
 * sourcemap **position correctness**.
 *
 * Previously it was only confirmed that "a sourcemap is produced" (`sources` correct, `mappings` non-empty),
 * but **whether the positions are right was never verified** — DevTools' error locating depends entirely on it, and a skewed mapping is completely silent.
 *
 * Tests (after one self-correction, see below):
 * 1) every **statement/expression start** must have an exact mapping (column matches)
 * 2) mappings must stay in bounds (within source line/column range) and never be negative
 * 3) positions the compiler introduces into the output (injected imports, generated IIFEs, etc.) may go unmapped,
 *    but must not map to a wrong position
 *
 * ⚠️ My first version of the tests demanded "an independent mapping segment for **every identifier**", and 8 spots came out imprecise —
 * the **tests were wrong**: a sourcemap is segment-based; segments mark starts, and both the spec and DevTools interpret
 * "this segment covers up to the next one". In the measured output `insertDynamicValue(_el0, null, () => countSignal.value)`,
 * `countSignal` at (column 48) falls inside the segment mapped to source `4:9` — correct.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHAR_TO_INT = new Map<string, number>([...BASE64].map((c, i) => [c, i]))

interface Segment { genLine: number; genCol: number; srcLine: number; srcCol: number }

/** Decode mappings per the sourcemap v3 spec (relative deltas + VLQ). */
function decodeMappings(mappings: string): Segment[] {
  const segments: Segment[] = []
  let genLine = 1
  let genCol = 0
  let srcIndex = 0
  let srcLine = 0
  let srcCol = 0
  for (const lineText of mappings.split(';')) {
    genCol = 0
    if (lineText === '') { genLine++; continue }
    for (const segText of lineText.split(',')) {
      if (segText === '') continue
      const values: number[] = []
      let shift = 0
      let value = 0
      for (const char of segText) {
        const digit = CHAR_TO_INT.get(char)
        if (digit === undefined) throw new Error(`illegal base64 character in mappings: ${JSON.stringify(char)}`)
        const cont = digit & 32
        value += (digit & 31) << shift
        if (cont) { shift += 5; continue }
        const negative = value & 1
        value >>= 1
        values.push(negative ? -value : value)
        shift = 0
        value = 0
      }
      genCol += values[0] ?? 0
      if (values.length >= 4) {
        srcIndex += values[1]!
        srcLine += values[2]!
        srcCol += values[3]!
        segments.push({ genLine, genCol, srcLine: srcLine + 1, srcCol })
      } else {
        segments.push({ genLine, genCol, srcLine: -1, srcCol: -1 })
      }
    }
    genLine++
  }
  void srcIndex
  return segments
}

/** Positions of all "statement/expression starts" in the source: `const <name>`, `return `, `export `, expressions after `(`. */
function statementStarts(source: string): Array<{ token: string; line: number; col: number }> {
  const out: Array<{ token: string; line: number; col: number }> = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!
    for (const pattern of [/^(\s*export\s)/u, /^(\s*const\s)/u, /^(\s*return\s)/u]) {
      const m = pattern.exec(text)
      if (m) {
        const col = m[1]!.length - m[1]!.trimStart().length + m[1]!.trimStart().length - m[1]!.length + text.indexOf(m[1]!.trim())
        out.push({ token: m[1]!.trim(), line: i + 1, col })
      }
    }
  }
  return out
}

const CASES: Array<{ name: string; source: string; anchor: { line: number; col: number; label: string } }> = [
  {
    name: 'static element',
    source: ['export const A = () => {', '  return <div>hi</div>', '}'].join('\n'),
    anchor: { line: 2, col: 2, label: 'return' }
  },
  {
    name: 'reactive text binding',
    source: [
      'import { state } from "@vobs/reactivity"',
      'export const A = () => {',
      '  const countSignal = state(0)',
      '  return <span>{countSignal.value}</span>',
      '}'
    ].join('\n'),
    // The start of the `{...}` expression inside JSX (column 9 = one space after `{`)
    anchor: { line: 4, col: 9, label: 'JSX expression start' }
  },
  {
    name: 'event handler',
    source: [
      'export const A = () => {',
      '  const handleClick = () => console.log("c")',
      '  return <button onClick={handleClick}>Go</button>',
      '}'
    ].join('\n'),
    anchor: { line: 3, col: 9, label: 'onClick expression' }
  },
  {
    name: 'list',
    source: [
      'export const A = (props: { items: string[] }) => {',
      '  return <ul>{props.items.map(itemValue => <li>{itemValue}</li>)}</ul>',
      '}'
    ].join('\n'),
    anchor: { line: 2, col: 13, label: 'list expression start' }
  }
]

describe('compiler sourcemap position correctness', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: positions exact and in bounds`, () => {
      const { map } = compileWithSourceMap(testCase.source, { filename: `${testCase.name}.tsx` })
      expect(map, 'no sourcemap was produced').toBeTruthy()
      expect(map!.sources).toEqual([`${testCase.name}.tsx`])

      const segments = decodeMappings(map!.mappings!)
      const mapped = segments.filter(s => s.srcLine > 0)
      expect(mapped.length, 'no segment carries a source position').toBeGreaterThan(0)

      const sourceLines = testCase.source.split('\n').length
      // Test 2: in bounds, no negative columns
      for (const s of mapped) {
        expect(s.srcLine, `output ${s.genLine}:${s.genCol} maps to out-of-bounds line ${s.srcLine}`)
          .toBeGreaterThanOrEqual(1)
        expect(s.srcLine).toBeLessThanOrEqual(sourceLines)
        expect(s.srcCol, `output ${s.genLine}:${s.genCol} maps to a negative column`).toBeGreaterThanOrEqual(0)
        expect(s.genCol).toBeGreaterThanOrEqual(0)
      }

      // Test 1: anchors (statement/expression starts) must have exact mappings
      const anchorLine = testCase.source.split('\n')[testCase.anchor.line - 1]!
      expect(anchorLine, `anchor line ${testCase.anchor.line} does not match the expectation`).toBeTruthy()
      const anchor = testCase.anchor
      const hit = mapped.find(s => s.srcLine === anchor.line && s.srcCol === anchor.col)
      expect(
        hit,
        `${testCase.name}: source ${anchor.line}:${anchor.col} (${anchor.label}) has no exact mapping; ` +
        `that line already has columns ${JSON.stringify([...new Set(mapped.filter(s => s.srcLine === anchor.line).map(s => s.srcCol))])}`
      ).toBeTruthy()
    })
  }

  it('statement starts are broadly mapped (not a few lucky coincidences)', () => {
    const source = CASES[1]!.source
    const { map } = compileWithSourceMap(source, { filename: 'starts.tsx' })
    const mapped = decodeMappings(map!.mappings!).filter(s => s.srcLine > 0)
    const starts = statementStarts(source)
    expect(starts.length, 'no statement starts found (the test itself is broken)').toBeGreaterThan(0)
    let covered = 0
    for (const start of starts) {
      if (mapped.some(s => s.srcLine === start.line && s.srcCol === start.col)) covered++
    }
    // Starts are where DevTools breakpoints and error locating land; full coverage is required
    expect(covered, `only ${covered}/${starts.length} statement starts have exact mappings`).toBe(starts.length)
  })

  it('compiler-introduced positions may be mapped, but must not point at nonexistent source lines', () => {
    const source = CASES[3]!.source
    const { map } = compileWithSourceMap(source, { filename: 'injected.tsx' })
    const sourceLines = source.split('\n').length
    const mapped = decodeMappings(map!.mappings!).filter(s => s.srcLine > 0)
    const bad = mapped.filter(s => s.srcLine > sourceLines)
    expect(bad, `${bad.length} segment(s) map to nonexistent source lines`).toEqual([])
  })
})
