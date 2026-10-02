/*
 * `VOBS_C106`：把 **async 函数**交给 effect / 生命周期（真实项目 2026-10-02 踩坑 3）。
 *
 * async 函数在**首个 await 之前**的代码同步执行，所以在 effect 追踪作用域里调用它 =
 * effect 亲自读了那些信号。典型的命中面是「守卫读 + 状态机写」：
 *
 * ```ts
 * effect(async () => {
 *   if (!entSync.value.syncing) return    // 读 → effect 订阅了 ent.sync
 *   entSync.set({ syncing: true })         // 写自己依赖的信号 → 无限重跑
 * })
 * ```
 *
 * ## 有意只检测**直接**形态
 *
 * `effect(async () => …)` 纯语法可见（回调带 `async` 修饰符），零成本零误报。
 * `effect(() => { void someAsyncFn() })` 这种**间接**形态，被调函数的 async-ness 在
 * 另一个模块，纯 AST 看不出来 —— 要检测必须引入 TypeChecker，而 Vite 的 transform
 * 是逐文件的，那会破坏架构。间接形态交给运行时护栏（C210/C211）。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c106 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C106')

describe('VOBS_C106 该报的形态', () => {
  it('`effect(async () => …)`', () => {
    expect(c106(`effect(async () => { await load() })`)).toHaveLength(1)
  })

  it('`onMount(async () => …)`', () => {
    expect(c106(`onMount(async () => { await load() })`)).toHaveLength(1)
  })

  it('async 函数表达式', () => {
    expect(c106(`effect(async function () { await load() })`)).toHaveLength(1)
  })

  it('`renderEffect` / `memo` / `on` 同样在检测面内', () => {
    for (const api of ['renderEffect', 'memo', 'on']) {
      expect(c106(`${api}(async () => { await load() })`), `${api} 没被检测`).toHaveLength(1)
    }
  })

  it('是 warning 而不是 error（不该挡构建）', () => {
    expect(c106(`effect(async () => { await load() })`)[0]!.severity).toBe('warning')
  })

  it('fix 文案给出 on() / onMount / untrack 三条出路', () => {
    const fix = c106(`effect(async () => { await load() })`)[0]!.fix ?? ''
    expect(fix).toContain('on(')
    expect(fix).toContain('onMount')
    expect(fix).toContain('untrack')
  })
})

describe('VOBS_C106 不该报的形态', () => {
  it('同步回调（间接调用看不出来 —— 这是有意的边界）', () => {
    expect(c106(`effect(() => { void load() })`)).toEqual([])
  })

  it('`effect(on(deps, () => …))` —— 正是推荐的修法', () => {
    expect(c106(`effect(on(session, () => { void load() }))`)).toEqual([])
  })

  it('显式 untrack 包裹', () => {
    expect(c106(`effect(() => { untrack(() => { void load() }) })`)).toEqual([])
  })

  it('非追踪 API 的 async 回调（事件回调不在追踪作用域）', () => {
    expect(c106(`handleClick(async () => { await load() })`)).toEqual([])
  })

  it('追踪 API 但第一个参数不是回调', () => {
    expect(c106(`effect(someOtherEffect)`)).toEqual([])
  })
})
