import { describe, it, expect, afterEach, vi } from 'vitest'
import { state, effect, untrack } from '@vobs/reactivity'
import {
  installDevGuardrails,
  isDevGuardrailsInstalled,
  VOBS_C210,
  VOBS_C211,
  type VobsDiagnostic
} from './dev'

/** 让调度器把挂起的微任务跑完。 */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

let uninstall: (() => void) | undefined
const collected: VobsDiagnostic[] = []

const start = (options: Parameters<typeof installDevGuardrails>[0] = {}): void => {
  collected.length = 0
  uninstall = installDevGuardrails({
    console: false,
    onDiagnostic: diagnostic => collected.push({ ...diagnostic }),
    ...options
  })
}

afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

describe('installDevGuardrails', () => {
  it('抓到 effect 自订阅，并给出信号名与正确写法', async () => {
    start()
    const count = state(0, 'count')

    const eff = effect(() => {
      const current = count.value
      if (current < 1) count.value = current + 1
    })
    await settle()

    const diagnostic = collected.find(item => item.code === VOBS_C210)
    expect(diagnostic).toBeDefined()
    expect(diagnostic?.severity).toBe('error')
    expect(diagnostic?.message).toContain('"count"')
    expect(diagnostic?.hint).toContain('untrack')
    expect(diagnostic?.count).toBe(1)
    eff.dispose()
  })

  it('用 untrack 包住写入的正确写法不报 —— 负向对照', async () => {
    start()
    const count = state(0, 'count')

    const eff = effect(() => {
      untrack(() => {
        count.value++
      })
    })
    await settle()

    expect(collected).toEqual([])
    expect(count.value).toBe(1)
    // 没有建立订阅，所以只跑了一次
    expect(eff.dependencies.size).toBe(0)
    eff.dispose()
  })

  it('未命名信号也能报出来，不是静默跳过', async () => {
    start()
    const anonymous = state(0)

    const eff = effect(() => {
      const current = anonymous.value
      if (current < 1) anonymous.value = current + 1
    })
    await settle()

    expect(collected.find(item => item.code === VOBS_C210)?.message).toContain('未命名信号')
    eff.dispose()
  })

  it('卸载后不再报告', async () => {
    start()
    uninstall?.()
    uninstall = undefined
    expect(isDevGuardrailsInstalled()).toBe(false)

    const count = state(0, 'count')
    const eff = effect(() => {
      const current = count.value
      if (current < 1) count.value = current + 1
    })
    await settle()

    expect(collected).toEqual([])
    eff.dispose()
  })

  it('重复安装是幂等的', () => {
    const first = installDevGuardrails({ console: false })
    uninstall = first
    const second = installDevGuardrails({ console: false })
    expect(second).toBe(first)
    expect(isDevGuardrailsInstalled()).toBe(true)
  })

  it('同一位置只记一条，之后只累加计数', async () => {
    start()
    const count = state(0, 'count')

    // 顶到上限前每次运行都会自写一次，位置相同 → 应合并成一条
    const eff = effect(() => {
      const current = count.value
      if (current < 3) count.value = current + 1
    })
    await settle()

    const matched = collected.filter(item => item.code === VOBS_C210)
    expect(matched.length).toBeGreaterThan(1) // 每次命中都回调
    expect(new Set(matched.map(item => item.site)).size).toBe(1) // 但只有一个位置
    expect(matched.at(-1)?.count).toBe(3) // 最后一次回调的计数是累计值
    // 回调拿到的是快照：早先那几条不该被后续命中改写
    expect(matched[0]?.count).toBe(1)
    eff.dispose()
  })

  it('时间窗内连跑超限时报循环风暴（跨 effect 互相触发的兜底）', async () => {
    // 这两个 effect 都不写自己的依赖，所以 C210 抓不到 —— 靠 C211 兜底
    start({ effectRerunLimit: 8, rerunWindowMs: 2000 })
    const a = state(0, 'a')
    const b = state(0, 'b')
    let rounds = 0
    const stop = 14

    const first = effect(() => {
      const value = a.value
      if (rounds < stop) {
        rounds += 1
        b.value = value + 1
      }
    })
    const second = effect(() => {
      const value = b.value
      if (rounds < stop) {
        rounds += 1
        a.value = value + 1
      }
    })
    await settle()
    await settle()

    const storm = collected.find(item => item.code === VOBS_C211)
    expect(storm).toBeDefined()
    expect(storm?.severity).toBe('error')
    expect(storm?.message).toContain('连跑')
    expect(collected.some(item => item.code === VOBS_C210)).toBe(false)
    first.dispose()
    second.dispose()
  })

  it('console: false 时不打 console，默认会打', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    start({ console: false })
    const quiet = state(0, 'quiet')
    const eff1 = effect(() => {
      const value = quiet.value
      if (value < 1) quiet.value = value + 1
    })
    await settle()
    expect(spy).not.toHaveBeenCalled()
    eff1.dispose()

    uninstall?.()
    collected.length = 0
    uninstall = installDevGuardrails({ onDiagnostic: d => collected.push(d) })
    const loud = state(0, 'loud')
    const eff2 = effect(() => {
      const value = loud.value
      if (value < 1) loud.value = value + 1
    })
    await settle()
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0]?.[0])).toContain(VOBS_C210)
    eff2.dispose()
    spy.mockRestore()
  })

  it('maxSites 之后不再新增位置', async () => {
    start({ maxSites: 1 })
    const one = state(0, 'one')
    const two = state(0, 'two')

    const eff1 = effect(() => {
      const value = one.value
      if (value < 1) one.value = value + 1
    })
    const eff2 = effect(() => {
      const value = two.value
      if (value < 1) two.value = value + 1
    })
    await settle()

    expect(new Set(collected.map(item => item.site)).size).toBeLessThanOrEqual(1)
    eff1.dispose()
    eff2.dispose()
  })
})
