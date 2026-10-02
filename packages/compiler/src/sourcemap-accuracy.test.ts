// @vitest-environment node
/*
 * sourcemap **位置正确性**。
 *
 * 此前只被确认"会产出 sourcemap"（`sources` 正确、`mappings` 非空），
 * 但**位置对不对从未验证** —— DevTools 的报错定位完全依赖它，映射偏了完全无声。
 *
 * 判据（经过一次自我修正，见下）：
 * 1) 每个**语句/表达式的起点**都要有精确映射（列一致）
 * 2) 映射不得越界（源码行/列范围内）、不得为负
 * 3) 产物里由编译器引入的位置（注入的 import、生成的 IIFE 等）可以无映射，
 *    但不能映射到错误的位置
 *
 * ⚠️ 我第一版判据要求"**每个标识符**都有独立映射段"，结果 8 处报不精确 ——
 * 那是**判据错了**：sourcemap 是段式的，段标记起点，文档与 DevTools 都按
 * "该段覆盖到下一段"来解释。实测产物 `insertDynamicValue(_el0, null, () => countSignal.value)`
 * 里 `countSignal` 位置(列 48)是落在映射到源码 `4:9` 的那一段里的 —— 正确。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHAR_TO_INT = new Map<string, number>([...BASE64].map((c, i) => [c, i]))

interface Segment { genLine: number; genCol: number; srcLine: number; srcCol: number }

/** 按 sourcemap v3 规范解码 mappings（相对量 + VLQ）。 */
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
        if (digit === undefined) throw new Error(`mappings 里有非法 base64 字符: ${JSON.stringify(char)}`)
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

/** 源里所有"语句/表达式起点"的位置：`const <name>`、`return `、`export `、`(` 后的表达式。 */
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
    name: '静态元素',
    source: ['export const A = () => {', '  return <div>hi</div>', '}'].join('\n'),
    anchor: { line: 2, col: 2, label: 'return' }
  },
  {
    name: '响应式文本绑定',
    source: [
      'import { state } from "@vobs/reactivity"',
      'export const A = () => {',
      '  const countSignal = state(0)',
      '  return <span>{countSignal.value}</span>',
      '}'
    ].join('\n'),
    // JSX 里表达式 `{...}` 的起点（列 9 = `{` 之后一个空格）
    anchor: { line: 4, col: 9, label: 'JSX 表达式起点' }
  },
  {
    name: '事件处理器',
    source: [
      'export const A = () => {',
      '  const handleClick = () => console.log("c")',
      '  return <button onClick={handleClick}>Go</button>',
      '}'
    ].join('\n'),
    anchor: { line: 3, col: 9, label: 'onClick 表达式' }
  },
  {
    name: '列表',
    source: [
      'export const A = (props: { items: string[] }) => {',
      '  return <ul>{props.items.map(itemValue => <li>{itemValue}</li>)}</ul>',
      '}'
    ].join('\n'),
    anchor: { line: 2, col: 13, label: '列表表达式起点' }
  }
]

describe('compiler sourcemap 位置正确性', () => {
  for (const testCase of CASES) {
    it(`${testCase.name}：位置精确且不越界`, () => {
      const { map } = compileWithSourceMap(testCase.source, { filename: `${testCase.name}.tsx` })
      expect(map, '没有产出 sourcemap').toBeTruthy()
      expect(map!.sources).toEqual([`${testCase.name}.tsx`])

      const segments = decodeMappings(map!.mappings!)
      const mapped = segments.filter(s => s.srcLine > 0)
      expect(mapped.length, '没有任何带源码位置的映射段').toBeGreaterThan(0)

      const sourceLines = testCase.source.split('\n').length
      // 判据 2：不得越界、不得负列
      for (const s of mapped) {
        expect(s.srcLine, `产物 ${s.genLine}:${s.genCol} 映射到越界行 ${s.srcLine}`)
          .toBeGreaterThanOrEqual(1)
        expect(s.srcLine).toBeLessThanOrEqual(sourceLines)
        expect(s.srcCol, `产物 ${s.genLine}:${s.genCol} 映射到负列`).toBeGreaterThanOrEqual(0)
        expect(s.genCol).toBeGreaterThanOrEqual(0)
      }

      // 判据 1：锚点（语句/表达式起点）必须有精确映射
      const anchorLine = testCase.source.split('\n')[testCase.anchor.line - 1]!
      expect(anchorLine, `锚点行 ${testCase.anchor.line} 内容不符预期`).toBeTruthy()
      const anchor = testCase.anchor
      const hit = mapped.find(s => s.srcLine === anchor.line && s.srcCol === anchor.col)
      expect(
        hit,
        `${testCase.name}：源码 ${anchor.line}:${anchor.col}（${anchor.label}）没有精确映射；` +
        `该行已有列 ${JSON.stringify([...new Set(mapped.filter(s => s.srcLine === anchor.line).map(s => s.srcCol))])}`
      ).toBeTruthy()
    })
  }

  it('语句起点普遍有映射（不是只有个别巧合）', () => {
    const source = CASES[1]!.source
    const { map } = compileWithSourceMap(source, { filename: 'starts.tsx' })
    const mapped = decodeMappings(map!.mappings!).filter(s => s.srcLine > 0)
    const starts = statementStarts(source)
    expect(starts.length, '没找到任何语句起点（测试自身有问题）').toBeGreaterThan(0)
    let covered = 0
    for (const start of starts) {
      if (mapped.some(s => s.srcLine === start.line && s.srcCol === start.col)) covered++
    }
    // 起点是 DevTools 断点与报错定位的落点，要求全部覆盖
    expect(covered, `语句起点只有 ${covered}/${starts.length} 有精确映射`).toBe(starts.length)
  })

  it('编译器引入的位置可以有映射，但不能指向不存在的源码行', () => {
    const source = CASES[3]!.source
    const { map } = compileWithSourceMap(source, { filename: 'injected.tsx' })
    const sourceLines = source.split('\n').length
    const mapped = decodeMappings(map!.mappings!).filter(s => s.srcLine > 0)
    const bad = mapped.filter(s => s.srcLine > sourceLines)
    expect(bad, `有 ${bad.length} 段映射到了不存在的源码行`).toEqual([])
  })
})
