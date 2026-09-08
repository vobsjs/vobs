import { describe, expect, it } from 'vitest'
import { effect, scheduleLow, state, scheduler } from './index'

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
