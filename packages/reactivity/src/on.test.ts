// @vitest-environment jsdom
/*
 * `on()` —— 显式声明 effect 依赖（真实项目 2026-10-02 踩坑 3）。
 *
 * ## 要锁住的缺陷形态
 *
 * `effect` 的依赖是**自动收集**的，而**「effect 只调了个函数」不等于没依赖**：
 * 被调函数在**首个 await 之前**的代码同步执行，所以它读/写的信号全算在 effect 头上。
 *
 * ```ts
 * effect(() => { if (session.value) void sync() })
 * //   sync() 首个 await 前：读 entSync.value.syncing（守卫）+ 写 entSync.set(...)
 * //   → effect 订阅了 ent.sync → 写它又触发 effect → 无限重同步（C210 + C211）
 * ```
 *
 * `untrack` 能治，但靠人记得；`on()` 让它**结构上写不出来**。
 *
 * ## 语义对齐 SolidJS 的 `on()`
 *
 * 只在声明的依赖变化时触发；回调体内的读取**不建立订阅**。
 */
import { describe, expect, it, vi } from 'vitest'
import { effect, on, scheduler, state, untrack } from './index'

const settle = (): void => { scheduler.flush() }

/** 复现踩坑 3 里的 async 同步函数：首个 await 之前读 + 写同一个信号。 */
function makeSyncLikeFn(entSync: ReturnType<typeof state<{ syncing: boolean }>>) {
  const calls: number[] = []
  return {
    calls,
    // async 函数：首个 await 之前的代码是同步执行的 —— 这正是坑的机制
    async run(): Promise<void> {
      if (entSync.value.syncing) return      // ← 守卫读（在 effect 追踪作用域内！）
      entSync.value = { syncing: true }      // ← 状态机写（触发自己）
      calls.push(1)
      await Promise.resolve()
      entSync.value = { syncing: false }     // ← 完成后再写一次
    }
  }
}

describe('on()：让「effect 调用 async 函数」不再自订阅', () => {
  it('**裸 effect 确实会订阅被调函数读的信号**（确定性复现，不触发循环）', () => {
    /*
     * 这里**刻意不写 async**：让裸 effect 真的进入"写自己依赖的信号"的循环，
     * 会与调度器的微任务交织，测试挂住 57 秒 —— 挂测试比没测试更糟。
     * 所以只验证机制的**第一环**：effect 调一个函数，那个函数读的信号会成为
     * effect 的依赖。踩坑 3 就是这一环 + "那个函数还写了同一个信号"。
     */
    const noise = state(0)
    function readInsideCalledFunction(): number {
      return noise.value        // ← 读取发生在被调函数里，但仍在 effect 追踪作用域内
    }

    let runs = 0
    const stop = effect(() => { runs++; void readInsideCalledFunction() })
    settle()
    expect(runs).toBe(1)

    noise.value = 1
    settle()
    expect(
      runs,
      'effect 没有订阅被调函数读的信号 —— 那踩坑 3 的机制就不成立，on() 也就没必要'
    ).toBe(2)
    stop.dispose()
  })
  it('用 on() 之后：写 async 函数碰过的信号**不再**触发 effect', () => {
    const session = state<string | null>('s1')
    const entSync = state({ syncing: false })
    const fn = makeSyncLikeFn(entSync)
    let runs = 0

    const stop = effect(on(session, () => {
      runs++
      if (session.value !== null) void fn.run()
    }))
    settle()
    const afterFirst = runs
    expect(afterFirst, 'on() 的首次求值应该调用一次').toBe(1)

    // 写 entSync —— 裸 effect 会因此重跑；on() 只订阅 session，所以不该重跑
    entSync.value = { syncing: false }
    settle()
    entSync.value = { syncing: true }
    settle()
    expect(
      runs,
      'entSync 变化触发了 effect —— on() 没有把回调放进 untrack 作用域'
    ).toBe(afterFirst)

    stop.dispose()
  })

  it('依赖本身变化时**照常**触发（on() 不是把一切都静音）', () => {
    const session = state('s1')
    const seen: string[] = []
    const stop = effect(on(session, value => { seen.push(value) }))
    settle()
    session.value = 's2'
    settle()
    session.value = 's3'
    settle()
    expect(seen, 'on() 把依赖变化也吞掉了').toEqual(['s1', 's2', 's3'])
    stop.dispose()
  })

  it('previous 是上一次的依赖值（首次为 undefined）', () => {
    const count = state(1)
    const pairs: Array<[number, number | undefined]> = []
    const stop = effect(on(count, (value, previous) => { pairs.push([value, previous]) }))
    settle()
    count.value = 2
    settle()
    count.value = 3
    settle()
    expect(pairs).toEqual([[1, undefined], [2, 1], [3, 2]])
    stop.dispose()
  })

  it('defer: true 时首次只记录、不调用（Solid 的语义）', () => {
    const count = state(1)
    const seen: number[] = []
    const stop = effect(on(count, value => { seen.push(value) }, { defer: true }))
    settle()
    expect(seen, 'defer 没生效，首次就调用了').toEqual([])
    count.value = 2
    settle()
    expect(seen).toEqual([2])
    stop.dispose()
  })

  it('依赖数组：任一变化都触发，且值是数组', () => {
    const a = state(1)
    const b = state(10)
    const seen: number[][] = []
    const stop = effect(on([a, b], values => { seen.push(values as number[]) }))
    settle()
    a.value = 2
    settle()
    b.value = 20
    settle()
    expect(seen).toEqual([[1, 10], [2, 10], [2, 20]])
    stop.dispose()
  })

  it('取值函数形式：可以传派生的显式来源', () => {
    const list = state([1, 2, 3])
    const seen: number[] = []
    const stop = effect(on(() => list.value.length, length => { seen.push(length) }))
    settle()
    list.value = [1, 2]
    settle()
    // 长度没变（3 → 2 变了）
    expect(seen).toEqual([3, 2])
    stop.dispose()
  })

  it('回调里的读取不订阅（与 async 无关的通用价值）', () => {
    const trigger = state(0)
    const noise = state(0)
    let runs = 0
    const stop = effect(on(trigger, () => {
      runs++
      void noise.value          // 裸 effect 会订阅 noise；on() 不该
    }))
    settle()
    const afterFirst = runs
    noise.value = 1
    settle()
    noise.value = 2
    settle()
    expect(runs, 'noise 被订阅了').toBe(afterFirst)
    trigger.value = 1
    settle()
    expect(runs, 'trigger 变化没触发').toBe(afterFirst + 1)
    stop.dispose()
  })

  it('传普通值（不是信号/数组/函数）→ 抛出并说明后果', () => {
    expect(() => effect(on(42 as never, () => undefined)))
      .toThrowError(/信号/u)
  })

  it('回调返回的清理函数被透出（effect 的 cleanup 契约不变）', () => {
    const trigger = state(0)
    const cleaned = vi.fn()
    const stop = effect(on(trigger, () => cleaned))
    settle()
    trigger.value = 1
    settle()
    // 上一次的 cleanup 应在重跑前被调用
    expect(cleaned).toHaveBeenCalled()
    stop.dispose()
  })
})

describe('on() 与 untrack 的关系（不是替代品）', () => {
  it('untrack 把整段都关掉；on() 保留声明的依赖', () => {
    const dep = state(0)
    let untrackedRuns = 0
    let onRuns = 0

    const stopA = effect(() => { untrack(() => { untrackedRuns++; void dep.value }) })
    const stopB = effect(on(dep, () => { onRuns++ }))
    settle()
    dep.value = 1
    settle()

    expect(untrackedRuns, 'untrack 连依赖都不订阅').toBe(1)
    expect(onRuns, 'on() 应该跟随依赖').toBe(2)
    stopA.dispose(); stopB.dispose()
  })
})
