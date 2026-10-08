/*
 * `VOBS_C108`：JSX 被存进变量（节点被急切创建）。
 *
 * 真实项目 2026-10-02 崩溃：
 * ```ts
 * const node = <ElementVarPicker el={pickerElement.value} />   // ← 急切创建
 * return open.value ? node : null                              // ← 条件在创建之后
 * ```
 * 组件在变量赋值那一刻就被实例化并跑了 body，那时 `pickerElement.value` 可能已是 null，
 * 于是读 `.content` 崩。
 *
 * ## 实测澄清的一个误解
 *
 * **属性表达式不是被编译器提升的。** 标准形态
 * `<div>{open.value ? <Picker el={picker.value}/> : null}</div>` 的产物是安全的 ——
 * `createComponent` 在条件内部、prop 是 getter。真正的差异是 **JSX 被写在了条件外面**。
 *
 * ## 它补上的是"靠纪律"的禁区
 *
 * 用户文档里两条禁区此前**零诊断**（实测 B/C/D 三类全静默）：编译通过、类型通过、
 * 运行期偶发崩。对 LLM 尤其致命 —— React 里
 * `const node = <X/>; return cond ? node : null` **完全合法**，是模型最容易写出的形状。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c108 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C108')

describe('VOBS_C108 该报的形态（节点被急切创建）', () => {
  it('JSX 存组件体变量，再用于条件（崩溃的原始形态）', () => {
    expect(c108(`export function P(){ const node = <Picker el={p.value} />; return open.value ? node : null }`))
      .toHaveLength(1)
  })

  it('JSX 存进数据常量（文档说"SSG 序列化必炸"）', () => {
    expect(c108(`export function P(){ const items = [{ icon: <Icon/> }]; return <div>{items.map(i => i.icon)}</div> }`))
      .toHaveLength(1)
  })

  it('组件体变量 + 无条件使用', () => {
    expect(c108(`export function P(){ const node = <Picker el={p.value} />; return <div>{node}</div> }`))
      .toHaveLength(1)
  })

  it('`let` 声明同样算（可能被条件重新赋值）', () => {
    expect(c108(`export function P(){ let node = <Picker/>; if (open.value) node = <Other/>; return node }`))
      .toHaveLength(1)
  })

  it('async 函数体内也报', () => {
    expect(c108(`export async function load(){ const node = <A/>; await tick(); return node }`)).toHaveLength(1)
  })

  it('是 warning 而不是 error（"用一次"其实能跑，真崩的是条件形态）', () => {
    expect(c108(`export function P(){ const node = <A/>; return <div>{node}</div> }`)[0]!.severity).toBe('warning')
  })

  it('fix 同时给出"写在用位置"与"返回节点的函数"两条出路', () => {
    const fix = c108(`export function P(){ const node = <A/>; return <div>{node}</div> }`)[0]!.fix ?? ''
    expect(fix).toContain('使用位置')
    expect(fix).toContain('=>')
    expect(fix, 'fix 应提醒别把节点存进数据常量').toContain('数据常量')
  })
})

describe('VOBS_C108 不该报的形态', () => {
  it('**返回节点的函数** —— 推荐写法（延迟求值）', () => {
    expect(c108(`export function P(){ const render = () => <Picker el={p.value} />; return <div>{render()}</div> }`))
      .toEqual([])
  })

  it('**标准子位置条件** —— 正确写法（实测产物安全）', () => {
    expect(c108(`export function P(){ return <div>{open.value ? <Picker el={p.value}/> : null}</div> }`))
      .toEqual([])
  })

  it('模块顶层变量**不归它管**（那是 VOBS_C105 的地盘，避免同一处报两条）', () => {
    expect(c108(`export const X = <div>a</div>`)).toEqual([])
  })

  it('函数体内的普通变量', () => {
    expect(c108(`export function P(){ const n = 1; return <div>{n}</div> }`)).toEqual([])
  })

  it('变量是函数（即使函数体里有 JSX）', () => {
    expect(c108(`export function P(){ const render = function () { return <A/> }; return <div>{render()}</div> }`))
      .toEqual([])
  })
})
