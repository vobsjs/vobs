/*
 * `VOBS_C105`: JSX at the **module top level**.
 *
 * Why it deserves a compile diagnostic (item F of the external pitfall docs): module-top-level expressions execute during **import evaluation**,
 * which is **before** `createVobs()` installs the renderer. So the `createElement` inside the JSX hits
 * "renderer not initialized" — the error happens at **runtime**, while some seemingly unrelated module is being imported,
 * with a stack trace far from the real cause ("this constant is written in the wrong place").
 *
 * Test: report only inside subtrees that "execute immediately at top-level evaluation"; stop at function bodies (lazy evaluation, the correct form).
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c105 = (source: string): Array<{ message: string; fix?: string; severity?: string; location: { line: number; file: string } }> =>
  compileWithSourceMap(source, { filename: 'case.tsx' })
    .diagnostics.filter(d => d.code === 'VOBS_C105')

describe('VOBS_C105 module-top-level JSX', () => {
  it("a top-level JSX constant is reported (item F's real shape)", () => {
    const found = c105("import { KitMenuItem } from './menu'\nexport const MENU = <KitMenuItem />")
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('renderer not initialized')
    expect(found[0]!.fix).toContain('component body')
    // A warning rather than an error: an error would make compile() throw, breaking every snippet-style tool
    expect(found[0]!.severity).toBe('warning')
  })

  it('a top-level JSX array is reported too', () => {
    expect(c105('const ITEMS = [<div>a</div>, <div>b</div>]')).toHaveLength(2)
  })

  it('a top-level fragment is reported too', () => {
    expect(c105('const X = <><div>a</div></>')).toHaveLength(1)
  })

  it('the location points at the JSX (usable line number)', () => {
    const found = c105("import x from 'y'\nexport const MENU = <div>a</div>")
    expect(found[0]!.location.line).toBe(2)
    expect(found[0]!.location.file).toBe('case.tsx')
  })

  it('JSX inside a component body must **not** be reported', () => {
    expect(c105('export const A = () => <div>ok</div>')).toEqual([])
  })

  it('functions returning nodes must **not** be reported (lazy evaluation; the recommended alternative)', () => {
    expect(c105('const menu = () => [<div>a</div>]')).toEqual([])
  })

  it('nested inside a function body is not reported either', () => {
    expect(c105('export function A() {\n  const items = [<b>x</b>]\n  return <div>{items}</div>\n}')).toEqual([])
  })

  it('top-level ordinary constants / function calls are not reported', () => {
    expect(c105("const NAME = 'vobs'")).toEqual([])
    expect(c105("const el = createElement('div')")).toEqual([])
  })

  it('import statements themselves are never false-positived', () => {
    expect(c105("import { a } from './x'")).toEqual([])
  })
})
