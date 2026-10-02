// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createOwner, effect, memo, state, type Signal } from '@vobs/reactivity'
import { createDevTools } from './index'

let active: ReturnType<typeof createDevTools> | undefined

afterEach(() => {
  active?.dispose()
  active = undefined
})

const BROAD = 3000

/**
 * devtools 的依赖图原来只有一张 `edges` 哈希表，**每个**取用点都全表扫：
 * - `collectEffectIds` / `collectAffectedSignals`：对每个被访问节点扫一遍 → O(V×E)；
 * - `effectInfo()`：每次调用扫全表求依赖（一次 effect 生命周期里调 4 次）；
 * - `signalInfo()`：每次调用扫全表求 subscribers 数。
 *
 * 实测 1 signal → 3000 memo + 3000 effect（6000 边）的广度拓扑、单次 signal 写入：
 * **修复前 581.19 / 586.92 / 598.07 ms → 修复后 25.70 / 18.42 / 20.04 ms（约 31×）**。
 * 瓶颈是"传播集合大"，不是边数。
 *
 * ⚠️ 计时必须每轮之间让调度器落定：传播遍历只在"该 signal 新建一条待处理更新"时跑，
 * 同一 signal 的连续写入会复用同一条 pending，测到的就只是快路径（会漏掉这个 bug）。
 */
describe('@vobs/devtools 传播遍历', () => {
  function buildBroad(owner: ReturnType<typeof createOwner>) {
    let broad!: Signal<number>
    owner.run(() => {
      broad = state(0)
      for (let index = 0; index < BROAD; index++) {
        const derived = memo(() => broad.value + index)
        effect(() => { void derived.value })
      }
    })
    return broad
  }

  it('广度拓扑：传播结果完整，且不再是 O(V×E)', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    const broad = buildBroad(owner)

    // 传播遍历只在"该 signal 新建一次待处理更新"时跑（同一 signal 的连续写入复用同一条 pending），
    // 所以每轮之间必须让调度器把 pending 落定，否则测到的是复用了 pending 的快路径。
    const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }
    const samples: number[] = []
    for (let round = 0; round < 3; round++) {
      await settle()
      const started = performance.now()
      broad.value += 1
      samples.push(performance.now() - started)
    }
    const elapsed = Math.min(...samples)
    await settle()

    // 传播集合必须是完整的 3000 个 effect（修索引时最容易在这里出错）
    const update = active.getUpdates().at(-1)!
    expect(update.affectedEffects).toHaveLength(BROAD)
    expect(active.getDependencies(update.signalId)).toHaveLength(BROAD)
    expect(active.getDependents(update.affectedEffects[0]!)).toHaveLength(1)

    // 修复前 581ms、修复后 18.4ms：上限取 100ms —— 给修复后留 5× 余量，对回归有 5× 判别力。
    expect(elapsed).toBeLessThan(100)
    owner.dispose()
  })

  it('链式与菱形传播仍然完整（邻接索引不改变语义）', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    let source!: Signal<number>
    const runs: number[] = []
    owner.run(() => {
      source = state(1)
      const first = memo(() => source.value + 1)
      const second = memo(() => first.value * 2)
      const left = memo(() => second.value + 10)
      const right = memo(() => second.value + 20)
      // 菱形：second 有两条下游，最后汇到同一个 effect
      effect(() => { runs.push(left.value + right.value) })
      // 链式：source → first → second → third → effect
      const third = memo(() => second.value + 100)
      effect(() => { runs.push(third.value) })
    })

    source.value = 5
    await Promise.resolve()

    const update = active.getUpdates().at(-1)!
    // 两个 effect 都必须被收集到（一条走菱形左支、一条走链式）
    expect(update.affectedEffects).toHaveLength(2)
    // 传播信号集合要覆盖整条链（source → first → second → left/right/third）
    expect(update.affectedSignals.length).toBeGreaterThanOrEqual(5)
    expect(runs.length).toBeGreaterThanOrEqual(4)
    owner.dispose()
  })
})
