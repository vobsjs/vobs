/*
 * `VOBS_C104`：组件顶层**裸条件 `return`**。
 *
 * 为什么值得一条编译错误：组件是 run-once 的 —— 函数体只执行一次，`cond` 在挂载那一刻定死，
 * 之后信号变化**不会**再执行这个 `return`，界面永远不会切换。而它与
 * 「JSX 子节点里的 `{cond ? <A/> : <B/>}`」（编译期生成响应式条件工厂）**长得极像**，
 * 靠人眼区分极难 —— 文档里这是"中招最多"的一条（总数/预览/进度/选中项全中过）。
 *
 * 更贵的一次事故（Labelune 发版黑屏）：`return cond ? <JSX/> : null` 的 `null` 分支
 * 曾被当成 WeakMap 的 key 直接抛错，App 挂载即崩且无崩溃日志。
 * 运行时已修（空值归一化成空注释节点），但**语义仍然是错的** —— 不切换。
 *
 * 判据：只在"函数体直接 return 三元、且有一支是 null/undefined/false"时报；
 * 子节点位置的条件、两支都是节点、嵌套函数内部都不该报。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c104 = (source: string): Array<{ code: string; message: string; fix?: string }> =>
  compileWithSourceMap(source, { filename: 'case.tsx' })
    .diagnostics.filter(d => d.code === 'VOBS_C104')

describe('VOBS_C104 顶层条件 return', () => {
  it('`return cond ? <JSX/> : null` 报错，并点出会返回 null', () => {
    const found = c104('export const A = (p: { on: boolean }) => {\n  return p.on ? <div>yes</div> : null\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('null')
    expect(found[0]!.message).toContain('run-once')
    expect(found[0]!.fix).toContain('JSX 子节点')
  })

  it('`return cond && <JSX/>` 报错（false 分支）', () => {
    const found = c104('export const B = (p: { on: boolean }) => {\n  return p.on && <div>yes</div>\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('false')
  })

  it('`return cond ? <A/> : undefined` 报错', () => {
    const found = c104('export const C = (p: { on: boolean }) => {\n  return p.on ? <b>y</b> : undefined\n}')
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('undefined')
  })

  it('JSX 子节点里的条件**不该**报（那是编译期生成的响应式条件工厂）', () => {
    expect(c104('export const D = (p: { on: boolean }) => {\n  return <div>{p.on ? <b>y</b> : <i>n</i>}</div>\n}')).toEqual([])
  })

  it('两支都是节点**不该**报（语义上仍不切换，但不涉及空值这条判断）', () => {
    expect(c104('export const E = (p: { on: boolean }) => {\n  return p.on ? <b>y</b> : <i>n</i>\n}')).toEqual([])
  })

  it('嵌套函数内部的 return **不该**报（不是组件本体的 return）', () => {
    expect(c104('export const F = () => {\n  const pick = (on: boolean) => (on ? 1 : null)\n  return <div>{pick(true)}</div>\n}')).toEqual([])
  })

  it('`.map` 回调里返回 null **不该**报（列表项的常见合法写法）', () => {
    expect(c104('export const G = (p: { xs: number[] }) => {\n  return <ul>{p.xs.map(x => (x > 0 ? <li>{x}</li> : null))}</ul>\n}')).toEqual([])
  })

  it('无条件的 return **不该**报', () => {
    expect(c104('export const H = () => {\n  return <div>plain</div>\n}')).toEqual([])
  })

  it('顶层 return 的定位指向那个三元表达式（行号可用）', () => {
    const result = compileWithSourceMap(
      'export const I = (p: { on: boolean }) => {\n  return p.on ? <div>yes</div> : null\n}',
      { filename: 'loc.tsx' }
    )
    const found = result.diagnostics.find(d => d.code === 'VOBS_C104')
    expect(found).toBeTruthy()
    expect(found!.location.line).toBe(2)
    expect(found!.location.file).toBe('loc.tsx')
    expect(found!.severity).toBe('error')
  })
})
