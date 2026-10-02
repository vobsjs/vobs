// @vitest-environment jsdom
/*
 * `Owner.removeCleanup` —— 撤销一条已注册的清理。
 *
 * 存在的理由：把"同一个逻辑资源"的清理**替换**掉，而不是每次重建都追加一条。
 * 典型场景是 `ref`：同一个 ref 对象先后绑到不同节点时，旧注册会在销毁时
 * 把新值清成 null（见 runtime/src/ref.ts 的注释与 ref-cleanup.test.ts）。
 *
 * 本包此前已经因为"cleanups 只增不减"吃过一次亏（runtime 的事件重绑），
 * 所以这个 API 的语义是"真的从数组里去掉"，不是标记失效。
 */
import { describe, expect, it } from 'vitest'
import { createOwner } from './owner'

describe('Owner.removeCleanup', () => {
  it('撤销后该清理不再执行', () => {
    const owner = createOwner()
    const ran: string[] = []
    const a = () => ran.push('a')
    const b = () => ran.push('b')
    owner.onDispose(a)
    owner.onDispose(b)
    owner.removeCleanup(a)
    owner.dispose()
    expect(ran).toEqual(['b'])
  })

  it('真的从数组里去掉（不是标记失效）', () => {
    const owner = createOwner()
    const before = owner.mark().cleanups
    const cleanups = [1, 2, 3].map(n => () => { void n })
    for (const c of cleanups) owner.onDispose(c)
    expect(owner.mark().cleanups - before).toBe(3)
    owner.removeCleanup(cleanups[1]!)
    // 计数必须下降 —— 若只是标记失效，这里仍是 3
    expect(owner.mark().cleanups - before).toBe(2)
    owner.dispose()
  })

  it('替换语义：同 key 反复注册只留最后一条', () => {
    const owner = createOwner()
    const ran: number[] = []
    const slot: { cleanup: (() => void) | null } = { cleanup: null }
    const before = owner.mark().cleanups
    for (let i = 0; i < 50; i++) {
      if (slot.cleanup) owner.removeCleanup(slot.cleanup)
      slot.cleanup = () => ran.push(i)
      owner.onDispose(slot.cleanup)
    }
    // 50 次"重绑"后仍然只占 1 个槽
    expect(owner.mark().cleanups - before).toBe(1)
    owner.dispose()
    expect(ran).toEqual([49])
  })

  it('没注册过 / 重复撤销 / 已销毁的 Owner 上调用都是安全的', () => {
    const owner = createOwner()
    const c = () => { /* noop */ }
    expect(() => owner.removeCleanup(c)).not.toThrow()
    owner.onDispose(c)
    owner.removeCleanup(c)
    expect(() => owner.removeCleanup(c)).not.toThrow()
    owner.dispose()
    expect(() => owner.removeCleanup(c)).not.toThrow()
  })

  it('不影响其它清理的执行顺序（仍是逆序）', () => {
    const owner = createOwner()
    const order: number[] = []
    const c1 = () => order.push(1)
    const c2 = () => order.push(2)
    const c3 = () => order.push(3)
    owner.onDispose(c1)
    owner.onDispose(c2)
    owner.onDispose(c3)
    owner.removeCleanup(c2)
    owner.dispose()
    expect(order).toEqual([3, 1])
  })
})
