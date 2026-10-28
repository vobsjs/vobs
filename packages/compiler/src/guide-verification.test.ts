/*
 * `vobs explain` 给出的**建议本身必须有效**（P3）。
 *
 * ## 这一轮吃过两次亏
 *
 * 1. **C104 的 fix 误导管线**：它推荐 `class={cond ? 'is-on' : 'is-off'}`，
 *    而真实项目只有组合选择器（`.seq-param-group.is-off`）—— 照着改会得到
 *    "类名加上了但样式不生效"。
 * 2. **C108 的 fix 第一版只对了一半**：它说"写到使用位置"，实测那**只对 JSX 子节点位置成立**；
 *    在组件顶层 `return` 处改成三元会**从"崩"变成"界面不切换"**（更隐蔽）。
 *
 * 两次都是**人肉发现**的。所以：**诊断的 fix 文案也是代码，也得验证。**
 *
 * ## 本文件怎么验证
 *
 * 对每个码给一对夹具：
 * - `wrong`：**必须**报出该码
 * - `correct`：**必须零诊断** ← 这是新的一类测试
 *
 * 第二个断言是重点：它证明"按建议改写之后真的干净了"，
 * 而不是"改成了另一个错"。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'
import { analyzeSource } from './analyze'

interface Pair {
  readonly code: string
  /** 触发该码的形态。 */
  readonly wrong: string
  /** 按 fix 改写后的形态 —— **必须零诊断**。 */
  readonly correct: string
}

const PAIRS: readonly Pair[] = [
  {
    code: 'VOBS_C104',
    wrong: 'export function P(){ return open.value ? <div>a</div> : null }',
    // 改成 JSX 子节点位置（fix 的第 ① 条）
    correct: 'export function P(){ return <div>{open.value ? <div>a</div> : null}</div> }'
  },
  {
    code: 'VOBS_C105',
    wrong: 'export const MENU = <div>顶层</div>',
    // 改成返回节点的函数（fix 的推荐）
    correct: 'export const menu = () => <div>顶层</div>'
  },
  {
    code: 'VOBS_C106',
    wrong: 'export function P(){ effect(async () => { await load() }) }',
    // 改成显式声明依赖（fix 的首选）
    correct: 'export function P(){ effect(on(deps, () => { void load() })) }'
  },
  {
    code: 'VOBS_C107',
    wrong: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
    // 放进 JSX 子节点位置
    correct: 'export function P(){ return <div>{cond.value ? <div>a</div> : <div>b</div>}</div> }'
  },
  {
    code: 'VOBS_C108',
    wrong: 'export function P(){ const node = <div>x</div>; return open.value ? node : null }',
    // 返回节点的函数（延迟求值）
    correct: 'export function P(){ const render = () => <div>x</div>; return open.value ? render() : null }'
  },
  {
    code: 'VOBS_C118',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      '  const count = state(0)',
      '  const snapshot = count.value',
      '  return <div>{snapshot}</div>',
      '}'
    ].join('\n'),
    // 读取放进 JSX 子节点位置（fix 的推荐）
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      "  const count = state(0, 'count')",
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n')
  },
  {
    code: 'VOBS_C210',
    wrong: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    // 改成显式声明依赖（fix 的首选是 on()，不是 untrack）
    correct: [
      "import { effect, on, state } from '@vobs/vobs'",
      'export function P() {',
      "  const count = state(0, 'count')",
      '  effect(on(count, () => { count.value = count.value + 1 }))',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n')
  },
  {
    code: 'VOBS_C232',
    wrong: 'export function P(){ return <div>{open.value ? items.value.map(i => <li key={i}/>) : <b/>}</div> }',
    // 把 list 提成直接的子表达式（fix 的推荐）
    correct: 'export function P(){ return <div>{open.value ? <b/> : null}{items.value.map(i => <li key={i}/>)}</div> }'
  },
  {
    code: 'VOBS_C233',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      '  const list = state([1, 2])',
      '  const add = () => { list.value.push(3) }',
      '  return <button onClick={add}>{list.value.length}</button>',
      '}'
    ].join('\n'),
    // 换引用（fix 的推荐）：push 换成展开重建
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const list = state([1, 2], 'list')",
      '  const add = () => { list.value = [...list.value, 3] }',
      '  return <button onClick={add}>{list.value.length}</button>',
      '}'
    ].join('\n')
  },
  {
    code: 'VOBS_C233',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      '  const rows = state([3, 1, 2])',
      '  const order = () => { rows.value.sort() }',
      '  return <button onClick={order}>{rows.value.join(",")}</button>',
      '}'
    ].join('\n'),
    // 排序同理：先拷贝再改，赋回新引用（fix 的第二条路径）
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const rows = state([3, 1, 2], 'rows')",
      '  const order = () => { rows.value = [...rows.value].sort() }',
      '  return <button onClick={order}>{rows.value.join(",")}</button>',
      '}'
    ].join('\n')
  },
  {
    code: 'VOBS_C120',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    // 补上与变量同名的调试名（fix 的推荐）
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const count = state(0, 'count')",
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n')
  },
  {
    // C107 空值守卫（2026-10-28 收编）：fix 的推荐是守卫下放进 JSX
    code: 'VOBS_C107',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const loading = state(true, 'loading')",
      '  if (loading.value) return null',
      '  return <div>done</div>',
      '}'
    ].join('\n'),
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const loading = state(true, 'loading')",
      '  return <div>{loading.value ? null : "done"}</div>',
      '}'
    ].join('\n')
  },
  {
    // C234（2026-10-28）：期望触发的信号要写进 deps（声明即订阅）
    code: 'VOBS_C234',
    wrong: [
      "import { effect, on, state } from '@vobs/vobs'",
      'export function P() {',
      "  const a = state(1, 'a')",
      "  const b = state(2, 'b')",
      '  effect(on([a], () => { console.log(a.value, b.value) }))',
      '  return <div>{b.value}</div>',
      '}'
    ].join('\n'),
    correct: [
      "import { effect, on, state } from '@vobs/vobs'",
      'export function P() {',
      "  const a = state(1, 'a')",
      "  const b = state(2, 'b')",
      '  effect(on([a, b], () => { console.log(a.value, b.value) }))',
      '  return <div>{b.value}</div>',
      '}'
    ].join('\n')
  },
  {
    // C233 字段版（2026-10-28）：对象字段直接赋值 → 整体换引用
    code: 'VOBS_C233',
    wrong: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const user = state({ name: 'a' }, 'user')",
      "  const rename = () => { user.value.name = 'b' }",
      '  return <button onClick={rename}>{user.value.name}</button>',
      '}'
    ].join('\n'),
    correct: [
      "import { state } from '@vobs/vobs'",
      'export function P() {',
      "  const user = state({ name: 'a' }, 'user')",
      "  const rename = () => { user.value = { ...user.value, name: 'b' } }",
      '  return <button onClick={rename}>{user.value.name}</button>',
      '}'
    ].join('\n')
  }
]

/** 该源码在**静态通道**上报出了哪些码（编译器 + 分析器合并，与 vobs check 一致）。 */
function codesOf(source: string): string[] {
  const compiled = compileWithSourceMap(source, { filename: 'a.tsx' }).diagnostics.map(item => item.code)
  const analyzed = analyzeSource(source, 'a.tsx').map(item => item.code)
  return [...new Set([...compiled, ...analyzed])]
}

describe('每条 fix 建议都必须有效', () => {
  for (const pair of PAIRS) {
    it(`${pair.code}：反例必须报出该码`, () => {
      expect(codesOf(pair.wrong), `${pair.code} 的反例夹具没触发它 —— 这个验证就是空的`).toContain(pair.code)
    })

    it(`${pair.code}：**按建议改写后必须零诊断**`, () => {
      const codes = codesOf(pair.correct)
      expect(codes, `${pair.code} 的建议改写后仍有诊断：${codes.join(', ')} —— 那是把用户引到另一个坑`).toEqual([])
    })
  }
})
