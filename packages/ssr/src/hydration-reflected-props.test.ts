// @vitest-environment jsdom
/*
 * Hydration round-trip: after `id` / `style` / `title` go through SSR serialization, client
 * hydration must **preserve** them, and reactivity must keep working after hydration.
 *
 * Why these three specifically: this round changed SSR attribute output (`18435dc` routed
 * them through the attribute channel). That change adds attributes to the output, and
 * hydration validates strictly — if the client does not claim these attributes,
 * strictHydration reports them as differences. So this test both fills the "hydration path"
 * coverage gap and regression-verifies the previous change.
 *
 * ⚠️ Assertions must wait for the scheduler to drain: signal writes are dispatched
 * asynchronously via `queueMicrotask` (`reactivity/src/scheduler.ts`). **Reading the DOM
 * synchronously sees stale values** — my first draft did exactly that and misjudged it as
 * "reactivity broken after hydration".
 * `scheduler.flush()` is the most reliable (no dependency on microtask counts).
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { bindText, createElement, createText, insertBefore, setProperty } from '@vobs/dom'
import { hydrate, renderToString } from './index'

const settle = (): void => { scheduler.flush() }

describe('hydration round-trip: always-reflected properties', () => {
  const render = () => {
    const div = createElement('div')
    setProperty(div, 'id', 'hero')
    setProperty(div, 'style', 'color:red')
    setProperty(div, 'title', '提示')
    const text = createText('')
    insertBefore(div, text, null)
    bindText(text, () => 'body')
    return div
  }

  it('the SSR output carries all three attributes', () => {
    const html = renderToString(render)
    expect(html).toContain('id="hero"')
    expect(html).toContain('title="提示"')
    expect(html).toMatch(/style="[^"]*color:\s*red/)
  })

  it('attributes survive hydration (not cleared or overwritten)', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)

    const div = document.body.querySelector('div')!
    expect(div.getAttribute('id')).toBe('hero')
    expect(div.getAttribute('title')).toBe('提示')
    expect(div.getAttribute('style')).toMatch(/color:\s*red/)
    expect(div.textContent).toBe('body')

    app.destroy()
    document.body.innerHTML = ''
  })

  it('hydration reuses server nodes (identity preserved) instead of rebuilding', () => {
    document.body.innerHTML = renderToString(render)
    const before = document.body.querySelector('div')
    const app = hydrate(render, document.body)
    expect(document.body.querySelector('div')).toBe(before)
    app.destroy()
    document.body.innerHTML = ''
  })

  it('strictHydration does not false-positive on these attributes', () => {
    /*
     * Note: `bindText` hydration is inherently the "server non-empty → client empty text
     * node" shape (`createText('')` + effect overwrite), and strictHydration reports content
     * for **dynamic text**. That is intentional semantics (see strict-hydration.test.ts),
     * so this test uses **static** content to isolate the attribute dimension.
     */
    const staticRender = () => {
      const div = createElement('div')
      setProperty(div, 'id', 'hero')
      setProperty(div, 'style', 'color:red')
      setProperty(div, 'title', '提示')
      insertBefore(div, createText('static'), null)
      return div
    }
    document.body.innerHTML = renderToString(staticRender)
    let error: unknown
    let app: { destroy(): void } | undefined
    try {
      app = hydrate(staticRender, document.body, { strictHydration: true })
    } catch (reason) {
      error = reason
    }
    expect(
      error,
      `strictHydration reported a difference: ${JSON.stringify((error as { vobsHydration?: unknown })?.vobsHydration)}`
    ).toBeUndefined()
    app?.destroy()
    document.body.innerHTML = ''
  })

  it('reactivity still works after hydration (bound effect follows signal updates)', () => {
    const value = state('first')
    const view = () => {
      const div = createElement('div')
      setProperty(div, 'id', 'live')
      const text = createText('')
      insertBefore(div, text, null)
      bindText(text, () => value.value)
      return div
    }
    document.body.innerHTML = renderToString(view)
    expect(document.body.textContent).toBe('first')

    const app = hydrate(view, document.body)
    expect(document.body.textContent).toBe('first')

    value.value = 'second'
    // Fix/verification point: the scheduler must drain before asserting
    settle()
    expect(document.body.textContent, 'binding did not follow signal updates after hydration').toBe('second')

    value.value = 'third'
    settle()
    expect(document.body.textContent).toBe('third')

    app.destroy()
    document.body.innerHTML = ''
  })
})
