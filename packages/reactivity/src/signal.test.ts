import { describe, it, expect, vi } from 'vitest'
import * as reactivity from './index'
import { state, effect, memo, createOwner, batch, scheduler, runWithOwner } from './index'
import type { Signal } from './index'
import { state as stateFromSubpath } from '@vobs/reactivity/state'

describe('reactivity', () => {
  it('仅公开 state 创建 API', () => {
    expect(reactivity.state).toBeTypeOf('function')
    expect('signal' in reactivity).toBe(false)
  })

  it('支持 state 子路径导入', () => {
    expect(stateFromSubpath(1).value).toBe(1)
  })

  it('state 读写', () => {
    const count = state(0)
    expect(count.value).toBe(0)
    count.value = 1
    expect(count.value).toBe(1)
  })

  it('set 与 .value = 赋值语义一致', async () => {
    const count = state(0)
    const fn = vi.fn(() => { void count.value })
    effect(fn)
    count.set(1)
    await Promise.resolve()
    expect(count.value).toBe(1)
    expect(fn).toHaveBeenCalledTimes(2)

    // Object.is 判等短路：相同值不触发订阅者
    count.set(1)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('set 可脱离对象直接作为回调传递', () => {
    const count = state(0)
    const setCount: (next: number) => void = count.set
    setCount(5)
    expect(count.value).toBe(5)
  })

  it('memo 没有 set，写入派生值被运行时拒绝', () => {
    const count = state(0)
    const doubled = memo(() => count.value * 2)
    expect('set' in doubled).toBe(false)
    expect(() => { (doubled as unknown as { value: number }).value = 10 }).toThrow()
  })

  it('支持创建时设置调试名称且不影响 state 行为', () => {
    const named = state(0, 'dashboard.lastAction')
    expect(reactivity.getSignalDebugName(named)).toBe('dashboard.lastAction')
    named.value = 1
    expect(named.value).toBe(1)
  })

  it('effect 响应 state 变化', async () => {
    const count = state(0)
    const fn = vi.fn(() => { void count.value })
    effect(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    count.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('effect 动态依赖切换', async () => {
    const a = state(0)
    const b = state(0)
    const flag = state(true)
    const fn = vi.fn(() => { void (flag.value ? a.value : b.value) })
    effect(fn)
    flag.value = false
    await Promise.resolve()
    a.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(2)
    b.value = 1
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('memo 在首次读取时惰性求值', () => {
    const count = state(0)
    const fn = vi.fn(() => count.value * 2)
    const doubled = memo(fn)
    expect(fn).not.toHaveBeenCalled()
    expect(doubled.value).toBe(0)
    expect(fn).toHaveBeenCalledTimes(1)
    count.value = 1
    expect(doubled.value).toBe(2)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('owner 级联销毁', () => {
    const parent = createOwner()
    let childOwner = createOwner()
    parent.run(() => { childOwner = createOwner() })
    expect(parent.children).toHaveLength(1)
    parent.dispose()
    expect(childOwner.disposed).toBe(true)
  })

  it('owner 销毁后 effect 不再执行', async () => {
    const owner = createOwner()
    const count = state(0)
    const callback = vi.fn(() => { void count.value })
    owner.run(() => effect(callback))
    owner.dispose()
    count.value = 1
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('state 不随 owner 销毁：作用域释放后信号仍可写、可被新效果订阅', async () => {
    // 方案 A 语义锁定：信号寿命 = 可达性。事件处理器经 owner.run 执行时创建的
    // state（如 store 数据），在触发它的 UI 作用域（如菜单下拉）销毁后必须仍有效。
    const owner = createOwner()
    let created!: Signal<number>
    owner.run(() => { created = state(1, 'scoped.state') })
    owner.dispose()
    expect(created.value).toBe(1)

    const callback = vi.fn(() => { void created.value })
    effect(callback)
    expect(callback).toHaveBeenCalledTimes(1)
    created.set(7)
    await Promise.resolve()
    expect(created.value).toBe(7)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('显式 dispose 后写入被忽略并警告一次（含调试名）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const count = state(0, 'legacy.count')
      count.dispose()
      count.value = 1
      count.set(2)
      expect(count.value).toBe(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('legacy.count')
    } finally {
      warn.mockRestore()
    }
  })

  it('batch 内多次修改只 flush 一次', () => {
    const count = state(0)
    const callback = vi.fn(() => { void count.value })
    effect(callback)
    batch(() => {
      count.value = 1
      count.value = 2
      count.value = 3
    })
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('memo 失效后通知依赖它的 effect', async () => {
    const count = state(1)
    const doubled = memo(() => count.value * 2)
    const values: number[] = []
    effect(() => { values.push(doubled.value) })
    count.value = 2
    await Promise.resolve()
    expect(values).toEqual([2, 4])
  })

  it('effect 重新执行和销毁时运行清理函数', async () => {
    const count = state(0)
    const owner = createOwner()
    const cleanups: number[] = []
    owner.run(() => effect(() => {
      const value = count.value
      return () => cleanups.push(value)
    }))
    count.value = 1
    await Promise.resolve()
    owner.dispose()
    expect(cleanups).toEqual([0, 1])
  })

  it('cleanup 异常由 Owner 边界处理，不会阻止下一次 effect 执行', async () => {
    const count = state(0)
    const owner = createOwner()
    const errors: unknown[] = []
    owner.onError(error => { errors.push(error) })
    let runs = 0
    owner.run(() => effect(() => {
      const value = count.value
      runs++
      return () => { if (value === 0) throw new Error('cleanup failed') }
    }))
    count.value = 1
    await Promise.resolve()
    expect(runs).toBe(2)
    expect(errors).toHaveLength(1)
    owner.dispose()
  })

  it('Scheduler 隔离单个 effect 异常并继续执行同一轮其他 effect', () => {
    const source = state(0)
    const calls: string[] = []
    effect(() => {
      if (source.value === 1) throw new Error('first effect failed')
    })
    effect(() => {
      source.value
      calls.push('second')
    })
    source.value = 1
    expect(() => scheduler.flush()).toThrow('first effect failed')
    expect(calls).toEqual(['second', 'second'])
  })

  it('state 对象和数组采用替换触发更新的浅层语义', async () => {
    const model = state({ count: 0 })
    const values: number[] = []
    effect(() => { values.push(model.value.count) })
    model.value.count = 1
    expect(values).toEqual([0])
    model.value = { count: 2 }
    await Promise.resolve()
    expect(values).toEqual([0, 2])
  })

  it('嵌套 effect 不会丢失外层依赖追踪', async () => {
    const outer = state(0)
    const inner = state(0)
    const callback = vi.fn(() => {
      void outer.value
      effect(() => { void inner.value })
    })
    effect(callback)
    outer.value = 1
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('Owner 销毁会从调度队列移除 effect', async () => {
    const count = state(0)
    const owner = createOwner()
    const callback = vi.fn(() => { void count.value })
    owner.run(() => effect(callback))
    count.value = 1
    owner.dispose()
    await Promise.resolve()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('异步 continuation 可显式重新进入捕获的 Owner', async () => {
    const owner = createOwner()
    let observed: ReturnType<typeof createOwner> | null = null
    await Promise.resolve()
    runWithOwner(owner, () => { observed = createOwner() })
    expect(observed).not.toBeNull()
    expect(observed!.parent).toBe(owner)
    owner.dispose()
  })

})
