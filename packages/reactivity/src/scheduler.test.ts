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
 * batch's error priority.
 *
 * The flush used to live in finally: when `fn()` threw, an error thrown by flush
 * itself would replace the original error (a throw in finally overrides the throw
 * in try), and the developer saw an error unrelated to their own code.
 */
describe('batch error priority', () => {
  it('when both fn and flush throw, fn\'s own error is thrown', () => {
    const value = state(0)
    let armed = false
    const handle = effect(() => {
      value.value
      if (armed) throw new Error('error from the flush phase')
    })
    armed = true

    expect(() => batch(() => {
      value.value = 1
      throw new Error('fn\'s own error')
    })).toThrow('fn\'s own error')

    handle.dispose()
  })

  it('when only flush throws, it is thrown as usual', () => {
    const value = state(0)
    let armed = false
    const handle = effect(() => {
      value.value
      if (armed) throw new Error('only the flush error')
    })
    armed = true

    expect(() => batch(() => { value.value = 1 })).toThrow('only the flush error')
    handle.dispose()
  })
})
