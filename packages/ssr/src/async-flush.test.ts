import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient } from '@vobs/resource'
import { effect, state } from '@vobs/vobs'
import { renderToStringAsync } from './render'

/*
 * `renderToStringAsync` used to run `app.update()` only **once** after `await prefetchAll()`.
 * Data arriving is just the first hop: the bound effect may still hold chained promises (or
 * the write itself triggers new effects) that need several more rounds of microtasks before
 * they settle — a single update makes that content **silently missing**, leaving stale
 * values in the HTML with no error and no clue. This pins down "flush until stable".
 */
function createHarness() {
  const resources = createResourceClient()
  const profile = resources.resource({
    key: ['async-ssr-profile'],
    fetcher: async () => 'Ada'
  })
  const label = state('loading')
  /*
   * After data arrives, schedule **one macrotask** (simulating a timer / second async
   * request inside the effect). Microtasks are not enough: `await prefetchAll()` itself
   * yields the microtask queue, so chained promises often finish before the first update —
   * in that case even "a single update" renders fine and the test would not bite (my first
   * draft did exactly that).
   */
  effect(() => {
    if (profile.data.value === null) return
    setTimeout(() => { label.value = `done:${profile.data.value}` }, 0)
  })

  const render = () => {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => label.value)
    return span
  }
  return { resources, render }
}

describe('renderToStringAsync flushes until stable', () => {
  it('async writes scheduled one hop after data arrives still make it into the final HTML', async () => {
    const { resources, render } = createHarness()
    const result = await renderToStringAsync(render, { resourceClient: resources })
    expect(result.html).toContain('done:Ada')
    resources.clear()
  })

  it('converges even without async tails (no timers involved)', async () => {
    const resources = createResourceClient()
    const profile = resources.resource({ key: ['async-ssr-plain'], fetcher: async () => 'Ada' })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => profile.data.value ?? 'loading')
      return span
    }
    const result = await renderToStringAsync(render, { resourceClient: resources })
    expect(result.html).toContain('Ada')
    resources.clear()
  })
})
