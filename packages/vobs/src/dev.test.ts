import { describe, it, expect, afterEach, vi } from 'vitest'
import { state, effect, untrack } from '@vobs/reactivity'
import {
  installDevGuardrails,
  isDevGuardrailsInstalled,
  VOBS_C210,
  VOBS_C211,
  type GuardrailViolation
} from './dev'

/** 让调度器把挂起的微任务跑完。 */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const locationKey = (violation: GuardrailViolation): string => {
  const { file, line } = violation.error.location ?? { file: '?', line: 0 }
  return `${file}:${line}`
}

let uninstall: (() => void) | undefined
const collected: GuardrailViolation[] = []

const start = (options: Parameters<typeof installDevGuardrails>[0] = {}): void => {
  collected.length = 0
  uninstall = installDevGuardrails({
    console: false,
    onViolation: violation => collected.push({ error: violation.error, count: violation.count }),
    ...options
  })
}

afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

describe('installDevGuardrails', () => {
  it('抓到 effect 自订阅，产出结构化 VobsError（码 / 层 / 修复建议 / 位置）', async () => {
    start()
    const count = state(0, 'count')

    const eff = effect(() => {
      const current = count.value
      if (current < 1) count.value = current + 1
    })
    await settle()

    const violation = collected.find(item => item.error.code === VOBS_C210)
    expect(violation).toBeDefined()
    expect(violation?.error).toBeInstanceOf(Error)
    expect(violation?.error.severity).toBe('error')
    expect(violation?.error.layer).toBe('constraint')
    expect(violation?.error.message).toContain('"count"')
    /*
     * 1.8.5 起 fix 的顺序是「先教结构，再教补丁」：
     * 首选 on()（显式声明依赖，回调在 untrack 作用域里跑），untrack 降为兜底。
     * 所以 example 示范的是 on()，而 fix 文本里仍然有 untrack（作为兜底）。
     */
    expect(violation?.error.fix).toContain('untrack')
    expect(violation?.error.fix, 'fix 应该先给结构解 on()').toContain('on(')
    expect(violation?.error.example).toContain('on(')
    // 位置指向用户调用处（本测试文件），而不是护栏内部或框架源码
    expect(violation?.error.location?.line).toBeGreaterThan(0)
    expect(violation?.error.location?.file).toContain('dev.test.ts')
    expect(violation?.error.location?.file).not.toContain('node_modules')
    expect(violation?.count).toBe(1)
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

    expect(collected.find(item => item.error.code === VOBS_C210)?.error.message).toContain('未命名信号')
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

  it('同一位置只留一条 error 对象，只累加计数', async () => {
    start()
    const count = state(0, 'count')

    const eff = effect(() => {
      const current = count.value
      if (current < 3) count.value = current + 1
    })
    await settle()

    const matched = collected.filter(item => item.error.code === VOBS_C210)
    expect(matched.length).toBeGreaterThan(1) // 每次命中都回调
    expect(new Set(matched.map(locationKey)).size).toBe(1) // 但只有一个位置
    expect(matched.at(-1)?.count).toBe(3) // 最后一次回调的计数是累计值
    expect(matched[0]?.count).toBe(1) // 早先那几条是快照，不该被改写
    // 合并时复用同一个 error 实例，调用方按引用去重即可
    expect(matched[0]?.error).toBe(matched.at(-1)?.error)
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

    const storm = collected.find(item => item.error.code === VOBS_C211)
    expect(storm).toBeDefined()
    expect(storm?.error.layer).toBe('constraint')
    expect(storm?.error.message).toContain('连跑')
    expect(storm?.error.fix).toContain('untrack')
    expect(collected.some(item => item.error.code === VOBS_C210)).toBe(false)
    first.dispose()
    second.dispose()
  })

  it('console: false 时不打 console，默认用 formatVobsError 打', async () => {
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
    uninstall = installDevGuardrails({ onViolation: v => collected.push({ error: v.error, count: v.count }) })
    const loud = state(0, 'loud')
    const eff2 = effect(() => {
      const value = loud.value
      if (value < 1) loud.value = value + 1
    })
    await settle()
    expect(spy).toHaveBeenCalled()
    // 复用框架的格式化器（开发环境布局：Code / Location / Fix）
    const printed = String(spy.mock.calls[0]?.[0])
    expect(printed).toContain(VOBS_C210)
    expect(printed).toContain('Fix:')
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

    expect(new Set(collected.map(locationKey)).size).toBeLessThanOrEqual(1)
    eff1.dispose()
    eff2.dispose()
  })
})
