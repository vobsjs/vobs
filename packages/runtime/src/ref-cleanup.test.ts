// @vitest-environment jsdom
/*
 * 回归：**坏的回调 ref 不得打断 Owner 的 dispose 级联**。
 *
 * 实测来源（端到端交互冒烟）：playground 的 `<ul ref={attachList}>` 里
 * `attachList(node)` 直接 `insertList(node, …)` 没判空。回调 ref 会在**卸载时以 null 调用**
 * （React 语义），于是收到 null 时抛
 *   TypeError: Cannot read properties of null (reading 'insertBefore')
 * 而该异常从 `onDispose` 里**冒了出去** —— 导致同一 Owner 后续的 cleanup
 * （effect 解绑、监听移除、其它 ref 清理）**全部不执行**。
 *
 * 这与 `owner.ts:114-128` 已经修过的"子 Owner 抛错不能中断级联"是同一类缺陷：
 * 清理路径必须逐个隔离，不能因为一个 cleanup 失败就丢下其余的。
 */
import { describe, expect, it, vi } from 'vitest'
import { createOwner, effect, state } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import { createElement, insertBefore, setRef } from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('回调 ref 在卸载时收到 null 的行为', () => {
  it('回调 ref 在挂载时收到节点、在 Owner 销毁时收到 null', () => {
    const owner = createOwner()
    const el = createElement('div')
    const seen: Array<unknown> = []
    owner.run(() => { setRef(el, (value: unknown) => { seen.push(value) }) })
    expect(seen).toEqual([el])

    owner.dispose()
    // React 语义：卸载时以 null 调用
    expect(seen).toEqual([el, null])
  })

  it('坏的回调 ref（不判空、收到 null 就抛）不得打断 dispose 级联', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const owner = createOwner()
    const el = createElement('div')
    const value = state(0)
    let effectRuns = 0
    let laterCleanupRan = false

    owner.run(() => {
      // 一个会在收到 null 时抛错的回调 ref（模拟未判空的 attachList）
      setRef(el, (node: unknown) => {
        if (node === null) throw new TypeError("Cannot read properties of null (reading 'insertBefore')")
      })
      // 这个 effect 代表"同一 Owner 里后续的 cleanup"
      effect(() => { value.value; effectRuns += 1 })
      // 再挂一个一定该执行的清理
      owner.onDispose(() => { laterCleanupRan = true })
    })

    expect(effectRuns).toBe(1)

    // 关键：dispose 不该因为那个坏 ref 回调而抛出去
    expect(() => owner.dispose()).not.toThrow()

    // 关键：后续清理必须都跑过（这正是修复前被丢掉的）
    expect(laterCleanupRan).toBe(true)
    value.value = 1
    await flush()
    expect(effectRuns).toBe(1)          // effect 已被解绑

    // 异常不该无声：要么记录，要么冒泡 —— 这里选择记录
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('对象型 ref 在销毁时被清成 null（跨 owner 改指时不覆盖）', () => {
    // 同一 owner：销毁时按注册逆序清理，旧注册会把 ref 清成 null —— 记录真实行为
    const owner = createOwner()
    const a = createElement('div')
    const target = { current: null as unknown }
    owner.run(() => { setRef(a, target) })
    expect(target.current).toBe(a)
    owner.dispose()
    expect(target.current).toBeNull()

    // 跨 owner：ref.ts 的守卫生效 —— 后一个 owner 的清理不会抹掉别人已改指的值
    const first = createOwner()
    const second = createOwner()
    const b = createElement('div')
    const c = createElement('div')
    const shared = { current: null as unknown }
    first.run(() => { setRef(b, shared) })
    second.run(() => { setRef(c, shared) })
    first.dispose()
    expect(shared.current).toBe(c)   // 已被 second 改指，first 的清理不该动它
    second.dispose()
    expect(shared.current).toBeNull()
  })

  it('ref 指向的节点被移除后，后续插入不该拿到 null 父节点', () => {
    const host = createElement('div')
    const list = createElement('ul')
    insertBefore(host, list, null)
    // 判空守卫的形态（修复后 playground 的写法）
    const attach = (node: Element | null): void => {
      if (!node) return
      const li = createElement('li')
      insertBefore(node, li, null)
    }
    attach(list)
    expect(list.children.length).toBe(1)
    expect(() => attach(null)).not.toThrow()
  })
})
