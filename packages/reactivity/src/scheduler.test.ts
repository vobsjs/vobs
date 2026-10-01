import { describe, expect, it } from 'vitest'
import { batch, effect, scheduleLow, state, scheduler } from './index'

describe('scheduler priorities', () => {
  it('runs normal effects before low-priority work', () => {
    const value = state(0)
    const lowValue = state(0)
    const order: string[] = []
    const normal = effect(() => { value.value; order.push('normal') })
    const low = effect(() => { lowValue.value; order.push('low') })
    order.length = 0
    scheduleLow(low)
    value.value = 1
    scheduler.flush()
    expect(order.slice(-2)).toEqual(['normal', 'low'])
    normal.dispose()
    low.dispose()
  })
})

/*
 * batch 的错误优先级。
 *
 * 原来 flush 放在 finally 里：`fn()` 抛错时，flush 自己再抛错就会把原始错误顶掉
 * （finally 里的 throw 覆盖 try 里的 throw），开发者看到的是一个和自己代码无关的错误。
 */
describe('batch 的错误优先级', () => {
  it('fn 与 flush 都抛错时，抛出 fn 自己的错误', () => {
    const value = state(0)
    let armed = false
    const handle = effect(() => {
      value.value
      if (armed) throw new Error('flush 阶段的错误')
    })
    armed = true

    expect(() => batch(() => {
      value.value = 1
      throw new Error('fn 自己的错误')
    })).toThrow('fn 自己的错误')

    handle.dispose()
  })

  it('只有 flush 抛错时照常抛出', () => {
    const value = state(0)
    let armed = false
    const handle = effect(() => {
      value.value
      if (armed) throw new Error('只有 flush 错')
    })
    armed = true

    expect(() => batch(() => { value.value = 1 })).toThrow('只有 flush 错')
    handle.dispose()
  })
})
