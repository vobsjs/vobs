/*
 * `VOBS_C107`：组件体里的 `return` 读了信号（run-once 冻结）。
 *
 * 真实项目 2026-10-02 踩坑 4：v2 壳给 `/login` 做「全屏直渲染」特例，写成
 * `if (router.currentRoute.value.path === '/login') return <LoginPage />`，
 * 构建通过，但登录成功跳到 /designer 后壳不出现 —— 读信号发生在组件体，值在挂载时固化。
 *
 * ## 这条规则存在的理由：**三种写法坏得一模一样**
 *
 * 实测编译产物确认，下面三者的产物里都**没有** `insertDynamic` / `createBlock`：
 *
 * ```ts
 * return cond.value ? <A/> : <B/>      // ① 两支均 JSX
 * if (cond.value) return <A/> …        // ② if 早退式
 * return cond.value ? <A/> : null      // ③ 一侧 null（C104 也报这个）
 * ```
 *
 * 因为**组件顶层 `return` 处没有 parent/anchor**，而响应式条件渲染需要一个能换内容的
 * 位置 —— 返回值**就是**那个节点本身。
 *
 * 而 C104 只认 ③（判据是空字面量），**默许了 ① 与 ②**，而它们同样冻结。
 * 这正是踩坑 4 的形态，也是必须另立一条规则的原因。
 *
 * ## 关键判据：**只报 JSX 之外**的读取
 *
 * ```ts
 * return cond.value ? <A/> : <B/>              // ❌ 冻结
 * return <div>{cond.value ? <A/> : <B/>}</div> // ✅ 子节点位置由编译期生成条件工厂
 * ```
 *
 * 两者长得像、后果相反。所以「走进 JSX 就停」是这条规则的核心。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c107 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C107')

describe('VOBS_C107 该报的形态（三种全冻结 + 变体）', () => {
  it('① 根级三元，两支均 JSX', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : <B/> }`)).toHaveLength(1)
  })

  it('② if 早退式（C104 管不到，但同样冻结）', () => {
    expect(c107(`export function S(){ if (cond.value) return <A/>; return <B/> }`)).toHaveLength(1)
  })

  it('③ 根级三元，一侧 null', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : null }`)).toHaveLength(1)
  })

  it('④ `&&` 形态', () => {
    expect(c107(`export function S(){ return cond.value && <A/> }`)).toHaveLength(1)
  })

  it('⑤ 点路径读取（踩坑 4 的实际形态）', () => {
    expect(c107(`export function S(){ return router.currentRoute.value.path === "/x" ? <A/> : <B/> }`))
      .toHaveLength(1)
  })

  it('⑥ `if` 分支里 return 节点', () => {
    expect(c107(`export function S(){ if (cond.value) { return <A/> } return <B/> }`)).toHaveLength(1)
  })

  it('是 warning 而不是 error（静态判不出"是不是组件"）', () => {
    expect(c107(`export function S(){ return cond.value ? <A/> : <B/> }`)[0]!.severity).toBe('warning')
  })

  it('fix 文案指向 RouterView / Show，并明说"提到顶层 return 不管用"', () => {
    const fix = c107(`export function S(){ return cond.value ? <A/> : <B/> }`)[0]!.fix ?? ''
    expect(fix).toContain('RouterView')
    expect(fix).toContain('Show')
    // 踩坑 4 的对策是错的 —— 文案必须点明，不能再让人以为写到顶层就行
    expect(fix).toContain('不管用')
  })
})

describe('VOBS_C107 不该报的形态（正确写法与无关写法）', () => {
  it('**JSX 子节点位置** —— 正确写法，编译期生成条件工厂', () => {
    expect(c107(`export function S(){ return <div>{cond.value ? <A/> : <B/>}</div> }`)).toEqual([])
  })

  it('**JSX 属性位置** —— 同样由绑定 effect 处理', () => {
    expect(c107(`export function S(){ return <div class={cond.value ? "on" : "off"} /> }`)).toEqual([])
  })

  it('return 节点但没读信号', () => {
    expect(c107(`export function S(){ return <div>static</div> }`)).toEqual([])
  })

  it('读信号但返回数据、不产出节点', () => {
    expect(c107(`export function S(){ return cond.value ? 1 : 2 }`)).toEqual([])
  })

  it('条件里没有信号读取（普通变量）', () => {
    expect(c107(`export function S({ on }: P){ return on ? <A/> : <B/> }`)).toEqual([])
  })
})

describe('VOBS_C107 调用点豁免（有名函数仅被 JSX 上下文调用 = 求值在响应式作用域）', () => {
  it('**只在 JSX 子节点调用** —— 分支求值随信号重算，不冻结（真实案例 groupCards）', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <div>{groupCards()}</div>
}`)).toEqual([])
  })

  it('**只在 JSX 属性位置调用** —— 属性经绑定 effect / getter 求值，同样响应式', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <Picker items={groupCards()} />
}`)).toEqual([])
  })

  it('**组件体同步调用** —— 函数体在组件体执行期跑过一遍，真冻结，照报', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  const cards = groupCards()
  return <div>{cards}</div>
}`)).toHaveLength(1)
  })

  it('**JSX 内嵌套函数里的调用** —— 调用点与 JSX 之间隔着函数边界，求值时机未知，保守照报', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <div>{() => groupCards()}</div>
}`)).toHaveLength(1)
  })

  it('**effect 回调里调用** —— 同样是组件体执行期（同步跑到首 await），照报', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  effect(() => { void groupCards() })
  return <B/>
}`)).toHaveLength(1)
  })

  it('**没有任何调用点**（组件本身 / 仅当值传递）—— 无法证明安全，保守照报', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  pass(groupCards)
  return <B/>
}`)).toHaveLength(1)
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return <A/>; return <B/> }
  return <B/>
}`)).toHaveLength(1)
  })

  it('豁免只作用于有名函数 —— 匿名宿主（IIFE）拿不到名字，保守照报（return + if 双路径各报一条）', () => {
    expect(c107(`export function S(){
  return (() => { if (cond.value) return <A/>; return <B/> })()
}`)).toHaveLength(2)
  })
})

describe('VOBS_C107 情况三：空值守卫（2026-10-28 收编，silent-failures 最后一条静默）', () => {
  it('`if (信号) return null` + 同函数 JSX return —— 组件形态照报', () => {
    const found = c107(`export function S(){
  if (loading.value) return null
  return <div>{content}</div>
}`)
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('空值守卫')
    expect(found[0]!.fix).toContain('下放进 JSX')
  })

  it('`return undefined` / `return false` 变体同样算空守卫', () => {
    expect(c107(`export function S(){ if (loading.value) return undefined; return <A/> }`)).toHaveLength(1)
    expect(c107(`export function S(){ if (loading.value) return false; return <A/> }`)).toHaveLength(1)
  })

  it('纯数据函数的空守卫**不报** —— 函数级收窄（无 JSX return = 不渲染，谈不上冻结）', () => {
    expect(c107(`export function S(props){
  const find = (id: string) => { if (id === '') return null; return props.items.find(i => i.id === id) }
  return <div>{find('a')?.name}</div>
}`)).toEqual([])
  })

  it('守卫版 helper **只在 JSX 调用** —— 豁免照常生效（真实案例 groupCards 的 null 变体）', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return null; return <B/> }
  return <div>{groupCards()}</div>
}`)).toEqual([])
  })

  it('守卫版 helper **组件体同步调用** —— 真冻结，照报', () => {
    expect(c107(`export function S(){
  const groupCards = () => { if (planGroup.value) return null; return <B/> }
  const cards = groupCards()
  return <div>{cards}</div>
}`)).toHaveLength(1)
  })

  it('守卫版 helper **无调用点**（跨文件使用/组件本身）—— 无法证明安全，保守照报', () => {
    expect(c107(`export function S(){
  if (loading.value) return null
  return <B/>
}`)).toHaveLength(1)
  })
})
