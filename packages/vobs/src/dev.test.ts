import { describe, it, expect, afterEach, vi } from 'vitest'
import { state, effect, untrack } from '@vobs/reactivity'
import {
  installDevGuardrails,
  isDevGuardrailsInstalled,
  VOBS_C210,
  VOBS_C211,
  type GuardrailViolation
} from './dev'

/** Let the scheduler finish its pending microtasks. */
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

  it('when the signal has no name, the error explains **the cause and the fix** (measured: barrel re-export)', async () => {
    /*
     * Four shapes, measured: importing directly from @vobs/reactivity / @vobs/vobs lets
     * the compiler infer the debugName from the variable name; importing through
     * **our own barrel re-export** does not — so the error shows (unnamed signal)
     * and the user has no idea what to change (in real feedback this was the most
     * expensive step). So the hint must state the cause and a one-line fix.
     */
    start()
    const count = state(0)                       // deliberately no debugName
    // Use the **converging** form (same as the existing tests): an infinite loop leaves
    // unhandled errors that interfere with other tests
    effect(() => {
      const current = count.value
      if (current < 1) count.value = current + 1
    })
    await settle()
    const violation = collected.find(item => item.error.code === VOBS_C210)
    expect(violation).toBeDefined()
    expect(violation!.error.message).toContain('unnamed signal')
    expect(violation!.error.message, 'missing the "why it has no name" explanation').toContain('barrel')
    expect(violation!.error.message, 'missing a one-line actionable fix').toContain('state(initial')
  })
  it('catches effect self-subscription and produces a structured VobsError (code / layer / fix / location)', async () => {
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
     * Since 1.8.5 the fix order is "teach the structure first, then the patch":
     * on() is preferred (explicit dependency declaration, callback runs in an untrack
     * scope), and untrack is demoted to a last resort. So the example demonstrates on(),
     * while the fix text still contains untrack (as the fallback).
     */
    expect(violation?.error.fix).toContain('untrack')
    expect(violation?.error.fix, 'the fix should offer the structural on() first').toContain('on(')
    expect(violation?.error.example).toContain('on(')
    // The location points at the user call site (this test file), not inside the guardrail or framework source
    expect(violation?.error.location?.line).toBeGreaterThan(0)
    expect(violation?.error.location?.file).toContain('dev.test.ts')
    expect(violation?.error.location?.file).not.toContain('node_modules')
    expect(violation?.count).toBe(1)
    eff.dispose()
  })

  it('the correct form — wrapping the write in untrack — does not report (negative control)', async () => {
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
    // No subscription was established, so it only ran once
    expect(eff.dependencies.size).toBe(0)
    eff.dispose()
  })

  it('unnamed signals are reported too, not silently skipped', async () => {
    start()
    const anonymous = state(0)

    const eff = effect(() => {
      const current = anonymous.value
      if (current < 1) anonymous.value = current + 1
    })
    await settle()

    expect(collected.find(item => item.error.code === VOBS_C210)?.error.message).toContain('unnamed signal')
    eff.dispose()
  })

  it('no longer reports after uninstall', async () => {
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

  it('repeated installs are idempotent', () => {
    const first = installDevGuardrails({ console: false })
    uninstall = first
    const second = installDevGuardrails({ console: false })
    expect(second).toBe(first)
    expect(isDevGuardrailsInstalled()).toBe(true)
  })

  it('the same location keeps a single error object and only accumulates the count', async () => {
    start()
    const count = state(0, 'count')

    const eff = effect(() => {
      const current = count.value
      if (current < 3) count.value = current + 1
    })
    await settle()

    const matched = collected.filter(item => item.error.code === VOBS_C210)
    expect(matched.length).toBeGreaterThan(1) // every hit notifies
    expect(new Set(matched.map(locationKey)).size).toBe(1) // but there is only one location
    expect(matched.at(-1)?.count).toBe(3) // the last notification carries the accumulated count
    expect(matched[0]?.count).toBe(1) // the earlier entries are snapshots and must not be rewritten
    // Merging reuses the same error instance; callers can deduplicate by reference
    expect(matched[0]?.error).toBe(matched.at(-1)?.error)
    eff.dispose()
  })

  it('reports a loop storm when re-runs exceed the limit within the time window (the cross-effect catch-all)', async () => {
    // Neither effect writes its own dependency, so C210 cannot catch them — C211 is the catch-all
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
    expect(storm?.error.message).toContain('ran')
    expect(storm?.error.fix).toContain('untrack')
    expect(collected.some(item => item.error.code === VOBS_C210)).toBe(false)
    first.dispose()
    second.dispose()
  })

  it('with console: false nothing is logged; by default it logs via formatVobsError', async () => {
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
    // Reuses the framework formatter (development layout: Code / Location / Fix)
    const printed = String(spy.mock.calls[0]?.[0])
    expect(printed).toContain(VOBS_C210)
    expect(printed).toContain('Fix:')
    eff2.dispose()
    spy.mockRestore()
  })

  it('after maxSites no new locations are added', async () => {
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
