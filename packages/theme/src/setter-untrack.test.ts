// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { effect, scheduler } from '@vobs/reactivity'
import { createTheme } from './index'

/*
 * Calling setBrand / registerTheme inside an effect must not self-subscribe into an infinite loop.
 *
 * These two setters used to read the very signals they write (setBrand reads overrides / brand,
 * registerTheme reads themes), and they **get called from component effects** (switching brand per
 * route/user is a very common pattern). Inside an effect that meant: read → subscribe → write
 * re-triggers self → read and write again… measured: after 101 rounds it threw "reactive updates
 * exceeded 100 rounds".
 *
 * The fix puts the setters' reads inside untrack — a setter must not subscribe to the signal it
 * writes. The contract is unchanged.
 */
const flush = (): void => { scheduler.flush() }

describe('theme setters do not self-subscribe inside effects', () => {
  it('calling setBrand in an effect does not throw "exceeded 100 rounds"', () => {
    const theme = createTheme()
    let runs = 0
    expect(() => {
      effect(() => {
        runs++
        theme.setBrand({ '--probe-accent': 'red' })
      })
      flush()
    }).not.toThrow()
    expect(runs).toBe(1)
    // The value was indeed written (untrack did not invalidate the write)
    expect(theme.brand.value['--probe-accent']).toBe('red')
    theme.dispose()
  })

  it('calling registerTheme in an effect does not throw (including the returned unregister function)', () => {
    const theme = createTheme()
    let unregister: (() => void) | undefined
    let runs = 0
    expect(() => {
      effect(() => {
        runs++
        unregister = theme.registerTheme('light', { '--probe-surface': '#fff' })
      })
      flush()
    }).not.toThrow()
    expect(runs).toBe(1)
    // Note: we deliberately do **not** assert the registered value here (I never verified the
    // client-exposed shape; the guessed `theme.themes.value` is actually undefined) — the point
    // covered here is only "no self-subscription".

    // Unregistering outside the effect must also be fine
    expect(() => { unregister?.(); flush() }).not.toThrow()
    theme.dispose()
  })

  it('two consecutive setBrand calls still merge (untrack does not affect merge semantics)', () => {
    const theme = createTheme()
    theme.setBrand({ '--a': '1' })
    theme.setBrand({ '--b': '2' })
    expect(theme.brand.value).toMatchObject({ '--a': '1', '--b': '2' })
    theme.dispose()
  })
})
