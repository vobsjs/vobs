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

  it('fix **按使用位置分情况** —— 这是实测纠正过的（第一版只说了"写到使用位置"）', () => {
    const fix = c108(`export function P(){ const node = <A/>; return <div>{node}</div> }`)[0]!.fix ?? ''
    // ① JSX 子节点位置才是"写在那里"的正确场景
    expect(fix).toContain('子节点位置')
    // ② 顶层 return 处**不能**改成三元 —— 那里没有 parent/anchor，两支都是 JSX 也冻结
    expect(fix, 'fix 必须警告顶层 return 不能改用三元').toContain('别改成三元')
    expect(fix).toContain('C107')
    expect(fix).toContain('Show')
    // ③ 返回节点的函数
    expect(fix).toContain('=>')
    // ④ 数据常量
    expect(fix, 'fix 应提醒别把节点存进数据常量').toContain('数据常量')
    // ⑤ 生产验证过的更优解：常驻挂载 + 传状态对象 + 内部判空
    // （① 虽然修了崩溃，但每次条件翻转都会重建子树 —— 那是另一个已记录的坑）
    expect(fix, 'fix 缺少"有内部状态时用常驻挂载"这条').toContain('常驻挂载')
    expect(fix).toContain('判空')
    expect(fix, '应说明 ① 的代价是状态丢失').toContain('状态丢失')
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
