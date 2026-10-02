/*
 * `VOBS_C104` 的**触发面收窄**（1.8.1）。
 *
 * 实战反馈（真实项目升级到 1.8.0）：这条在 18 处命中里约 **16 处是纯数据函数误报**，
 * 而它是 `error` —— 直接挡构建，升级期变成打地鼠。用户给的两类误报源都确认存在：
 *
 * 1. `return cond && value` —— 1.8.0 对**任何** `return &&` 无条件报，完全不看右值是什么
 * 2. `return x ? x : null` —— 只看分支是不是空，不看返回值是不是**渲染节点**，
 *    于是 `T | null` 这种正常的空值建模全被报成"组件顶层条件 return"
 *
 * 立论只在"返回值会被渲染"时成立：组件 run-once → 那个 return 永不重算；
 * 纯数据函数每次调用都执行，条件 return 完全正常。
 *
 * 收窄后仍是启发式（"这个函数是不是组件"静态判不出来），所以同时从 error 降为 warning。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c104 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C104')

describe('VOBS_C104 不该报的形态（纯数据函数 —— 报告里的误报源）', () => {
  it('`return v ? v : null`（T | null 的正常空值建模）', () => {
    expect(c104(`
      type User = { name: string }
      function pick(value: User | null): User | null {
        return value ? value : null
      }
    `)).toEqual([])
  })

  it('`return a && b`（纯数据，右值不是节点）', () => {
    expect(c104(`
      function nameOf(user: { name: string } | null): string | null {
        return user && user.name
      }
    `)).toEqual([])
  })

  it('`return list.length && list[0]`', () => {
    expect(c104(`
      function first<T>(list: T[]): T | null {
        return list.length && list[0]
      }
    `)).toEqual([])
  })

  it('单表达式箭头里的数据条件', () => {
    expect(c104(`
      const trim = (text: string | null) => text ? text.trim() : null
      const label = (n: number | null) => n && String(n)
    `)).toEqual([])
  })

  it('`if` 早退式（本来就不报）', () => {
    expect(c104(`
      function resolve(value: string | null): string {
        if (!value) return ''
        return value
      }
    `)).toEqual([])
  })

  it('`Boolean()` 包裹（本来就不报）', () => {
    expect(c104(`
      function has(value: unknown) {
        return Boolean(value) && true
      }
    `)).toEqual([])
  })

  it('三元但两个分支都是数据（即使看起来像"返回空"）', () => {
    expect(c104(`
      function pick(a: number | null, b: number | null): number | null {
        return a ? a : undefined
      }
    `)).toEqual([])
  })
})

describe('VOBS_C104 该报的形态（真的会渲染）', () => {
  it('`return cond && <A/>`', () => {
    const found = c104(`
      export function Panel() {
        const open = state(true)
        return open.value && <div>内容</div>
      }
    `)
    expect(found).toHaveLength(1)
    expect(found[0]!.fix).toContain('Show')
  })

  it('`return cond ? <A/> : null`', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? <div>内容</div> : null
      }
    `)).toHaveLength(1)
  })

  it('`return cond ? null : <B/>`', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? null : <div>空态</div>
      }
    `)).toHaveLength(1)
  })

  it('**是 warning 而不是 error**（静态判不出"是不是组件"，不该挡构建）', () => {
    const found = c104(`
      export function Panel() {
        return open.value && <div>内容</div>
      }
    `)
    expect(found[0]!.severity).toBe('warning')
  })

  it('fix 文案不再依赖全局工具类（指向 Show / classList）', () => {
    const found = c104(`
      export function Panel() {
        return open.value && <div>内容</div>
      }
    `)
    const fix = found[0]!.fix ?? ''
    expect(fix).toContain('Show')
    expect(fix).toContain('classList')
    /*
     * 重点是**不用 `class=` 拼字符串**：1.8.0 的文案是
     * `<A class={cond ? 'is-on' : 'is-off'} />`，那要求项目里预先存在一个
     * **全局** `.is-off` 工具类；而真实项目往往只有组合选择器
     * （`.seq-param-group.is-off`），照着改会得到"类名加上了但样式不生效"。
     * `classList` 无需预先存在任何类。
     */
    expect(fix).not.toContain('class={')
  })
})

describe('VOBS_C104 嵌套与边界', () => {
  it('不下钻嵌套函数（内层是它自己的作用域）', () => {
    // 外层返回的是节点所以报；内层是数据函数所以不报 —— 只应有 1 条
    const found = c104(`
      export function Panel() {
        const label = (u: {n: string} | null) => u ? u.n : null
        return open.value && <div>{label(user)}</div>
      }
    `)
    expect(found).toHaveLength(1)
  })

  it('JSX 子节点位置的三元**不该**报（那是正确写法）', () => {
    expect(c104(`
      export function Panel() {
        return <div>{open.value ? <A/> : <B/>}</div>
      }
    `)).toEqual([])
  })

  it('`return cond1 ? <A/> : <B/>` 两个分支都是节点，没有空分支 → 不报', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? <A/> : <B/>
      }
    `)).toEqual([])
  })
})
