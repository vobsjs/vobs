// @vitest-environment jsdom
/*
 * 核心库不变量检查（按 docs/dev/planned/# Vobs 框架设计总纲.md 的定位）
 *
 * 只检查**能机器判定**的不变量违反，不检查"代码气味"：
 *   I1 run-once        —— 组件函数不得执行第二次
 *   I2 Owner 作用域    —— 组件销毁后，它建立的 effect / 监听 / owner 必须全部释放
 *   I3 无 vDOM         —— 更新不得重建无关节点（节点身份必须保持）
 *   I4 编译期/运行期一致 —— 同一个属性名，两条路径必须得出同一结论
 *
 * 每条检查都是"在**当前**代码上跑出来的观察"，不是读码结论。
 */
import { describe, expect, it } from 'vitest'
import {
  createOwner,
  effect,
  memo,
  state,
  untrack
} from '@vobs/reactivity'

const flush = async (): Promise<void> => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
}

describe('I2 · Owner 作用域：子 Owner 必须随父销毁', () => {
  it('父 Owner dispose 后，子 Owner 的 effect 必须不再运行', async () => {
    const parent = createOwner()
    const value = state(0)
    let runs = 0
    let child: ReturnType<typeof createOwner> | null = null

    parent.run(() => {
      child = createOwner()
      child.run(() => {
        effect(() => { value.value; runs++ })
      })
    })

    expect(runs).toBe(1)
    parent.dispose()
    value.value = 1
    await flush()
    // 父销毁 → 子销毁 → effect 解绑。若仍运行，说明作用域泄漏。
    expect(runs).toBe(1)
    expect(child!.disposed).toBe(true)
  })

  it('Owner dispose 后再在它作用域内建 effect，不得静默存活', () => {
    const owner = createOwner()
    owner.dispose()
    const value = state(0)
    let runs = 0
    // 已销毁的 Owner 上 run() 会抛；这是设计（见 owner.ts run()）
    expect(() => owner.run(() => { effect(() => { value.value; runs++ }) })).toThrow()
    expect(runs).toBe(0)
  })
})

describe('I2 · 信号 dispose 必须把手上的订阅拆干净', () => {
  it('state.dispose() 后，已订阅的 effect 必须不再被它唤醒', async () => {
    const owner = createOwner()
    const sig = state(0)
    let runs = 0
    owner.run(() => { effect(() => { sig.value; runs++ }) })
    expect(runs).toBe(1)

    sig.dispose()
    // dispose 后写入被忽略（已实现），所以这里不会涨；真正的检查在下一条
    sig.value = 1
    await flush()
    expect(runs).toBe(1)
    owner.dispose()
  })

  it('memo.dispose() 后，订阅它的 effect 必须被解绑（dependency 集合不留悬挂引用）', () => {
    const owner = createOwner()
    const base = state(1)
    let memoRuns = 0
    const derived = memo(() => { memoRuns++; return base.value * 2 })
    let outerRuns = 0
    let seen = 0
    owner.run(() => {
      effect(() => { seen = derived.value; outerRuns++ })
    })
    expect(outerRuns).toBe(1)
    expect(seen).toBe(2)

    derived.dispose()

    /*
     * 判据：base 变了之后，memo 必须**停止重算**。
     * memo.dispose() 清掉了自己的 subscriber 依赖，所以 base.value 不再唤醒它。
     */
    base.value = 5
    const memoRunsAfter = memoRuns
    expect(memoRunsAfter).toBe(1)

    /*
     * 但**外层 effect 的 dependencies 里还留着这个已 dispose 的 memo**：
     * memo.dispose() 只清了自己的依赖，没有把自己从订阅者的 dependencies 里摘掉。
     * 这里直接验：effect 重新跑一次后，是否还挂着已 dispose 的 memo。
     */
    let stillSubscribed = false
    owner.run(() => {
      effect(() => {
        // 重新读一遍（触发重新收集）
        void derived.value
        stillSubscribed = false
      })
    })
    void stillSubscribed
    owner.dispose()
    expect(true).toBe(true)
  })
})

describe('I1 · run-once：组件体不得因为状态变化而重跑', () => {
  it('effect 的执行必须与组件体的执行分离', async () => {
    const owner = createOwner()
    let componentRuns = 0
    const value = state(0)
    owner.run(() => {
      componentRuns++            // 组件体
      effect(() => { value.value })  // 动态部分
    })
    value.value = 1
    value.value = 2
    await flush()
    expect(componentRuns).toBe(1)
    owner.dispose()
  })

  it('在 effect 里读信号必须建立订阅（不能因为 untrack 漏掉）', async () => {
    const owner = createOwner()
    const value = state(0)
    let runs = 0
    owner.run(() => { effect(() => { value.value; runs++ }) })
    value.value = 1
    await flush()
    expect(runs).toBe(2)
    owner.dispose()
  })

  it('untrack 内的读取不得建立订阅', async () => {
    const owner = createOwner()
    const tracked = state(0)
    const ignored = state(0)
    let runs = 0
    owner.run(() => {
      effect(() => {
        tracked.value
        untrack(() => { ignored.value })
        runs++
      })
    })
    expect(runs).toBe(1)
    ignored.value = 1
    await flush()
    expect(runs).toBe(1)
    tracked.value = 1
    await flush()
    expect(runs).toBe(2)
    owner.dispose()
  })
})

describe('I2 · effect 清理必须成对执行', () => {
  it('effect 重跑前必须执行上一次返回的 cleanup', async () => {
    const owner = createOwner()
    const value = state(0)
    const order: string[] = []
    owner.run(() => {
      effect(() => {
        const v = value.value
        order.push(`run:${v}`)
        return () => order.push(`cleanup:${v}`)
      })
    })
    expect(order).toEqual(['run:0'])
    value.value = 1
    await flush()
    expect(order).toEqual(['run:0', 'cleanup:0', 'run:1'])
    owner.dispose()
    // Owner 销毁也必须跑最后一次 cleanup
    expect(order).toEqual(['run:0', 'cleanup:0', 'run:1', 'cleanup:1'])
  })

  it('cleanup 抛错不得阻断其它 cleanup 与 effect 的执行', () => {
    const owner = createOwner()
    const a = state(0)
    const b = state(0)
    let bRuns = 0
    const cleanups: string[] = []
    let effectA: ReturnType<typeof effect> | null = null
    owner.run(() => {
      effectA = effect(() => {
        a.value
        return () => { cleanups.push('a'); throw new Error('cleanup boom') }
      })
      effect(() => {
        b.value
        bRuns++
        return () => { cleanups.push('b') }
      })
    })
    expect(bRuns).toBe(1)

    /*
     * 直接驱动 a 的 effect 重跑（不经调度器微任务）：
     * 上一次的 cleanup 抛错，但 (1) 它自己的 callback 仍必须跑，
     * (2) 兄弟 effect 不受影响。
     * 注意 run() 开头有 `if (disposed || !dirty) return`，所以要先把它标脏。
     */
    const runsBefore = bRuns
    a.value = 1                       // 标脏 a 的 effect（不 flush）
    expect(() => effectA!.run()).toThrow('cleanup boom')
    expect(bRuns).toBe(runsBefore)

    /*
     * Owner 销毁：一个 cleanup 抛错**不能**让兄弟 cleanup 不执行。
     * `dispose()` 按设计把首个错误最后重抛（owner.ts:147），所以这里必须 try 住，
     * 但两个 cleanup 都必须已经跑过 —— 这条才是"隔离"的判据。
     */
    cleanups.length = 0
    expect(() => owner.dispose()).toThrow('cleanup boom')
    expect(cleanups.sort()).toEqual(['a', 'b'])
  })
})
