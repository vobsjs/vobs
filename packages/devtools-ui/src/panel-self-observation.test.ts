// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDevTools } from '@vobs/devtools'
import { hydrate, renderToString } from '@vobs/ssr'
import { bindText, createDOMRenderer, createElement, createText, createVobs, insertBefore, state } from '@vobs/vobs'
import { DevToolsPanel, DevToolsToolbar } from './panel'
import { DevToolsWidget } from './widget'

/*
 * The panel **observes itself**: its 19 local `state()`s and side effects are all created under
 * its own owner, and the only basis on which devtools identifies "internal" is **ancestor owner
 * names starting with `DevTools`**
 * (isInternalOwnerId in devtools/src/index.ts → debugComponentName(name).startsWith('DevTools')).
 * The panel never named its own owner → its signals/side effects were all recorded as app data
 * and fed back into its own listings.
 * Measured (before the fix): `getSignals()` returned 20 entries (only 1 actually created by the
 * app); on an empty devtools every broadcast bumped updates +1 / effects +1 / DOM +80, 6 rounds
 * took nodes 93→521, and a single refresh cost 546ms with 50 updates.
 */
describe('DevToolsPanel does not observe itself', () => {
  function mountPanel(devtools: ReturnType<typeof createDevTools>) {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsPanel({ api: devtools })
    })
    app.mount(host)
    return { host, app }
  }

  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

  it('mounting the panel itself adds nothing to the observed data', async () => {
    const devtools = createDevTools({ expose: false })
    // warm-up: let one-shot side effects like @vobs/ui's module-level signals (icon registry
    // version) happen first, so they are not counted as "brought in by the panel"
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length,
      updates: devtools.getUpdates().length
    }
    const view = mountPanel(devtools)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)
    expect(devtools.getUpdates().length).toBe(before.updates)

    // external signals are still observed (the panel was not blinded), and exactly one more update lands
    const external = state(0)
    external.value = 1
    await settle()
    expect(devtools.getUpdates().length).toBe(before.updates + 1)

    view.app.destroy()
    devtools.dispose()
  })

  it('mounting DevToolsWidget standalone likewise adds nothing to the observed data', async () => {
    const devtools = createDevTools({ expose: false })
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length
    }
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsWidget({ api: devtools })
    })
    app.mount(host)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)

    app.destroy()
    devtools.dispose()
  })

  it('mounting DevToolsToolbar standalone likewise adds nothing to the observed data', async () => {
    const devtools = createDevTools({ expose: false })
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length
    }
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsToolbar({ api: devtools, query: { value: '' } })
    })
    app.mount(host)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)

    app.destroy()
    devtools.dispose()
  })

  /*
   * The devtools-ui item "renders hydration-provisional-text" needs **no code change**:
   * `renderLifecycleTimeline` (panel.tsx:1207-1209) renders `event.type` directly **as text**,
   * with neither a label table nor an exhaustive switch. This test guards against it later being
   * changed to "look up by key in a table" and silently dropping new types.
   */
  it('the panel still renders when the lifecycle contains hydration-provisional-text', async () => {
    const devtools = createDevTools({ expose: false })
    const view = mountPanel(devtools)
    await settle()

    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    await settle()

    expect(devtools.getLifecycleEvents().some(event => event.type === 'hydration-provisional-text')).toBe(true)
    // the panel was not broken by this new type (content still mounted)
    expect(view.host.childNodes.length).toBeGreaterThan(0)

    app.destroy()
    view.app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })

  /*
   * The "unverified" note left by §18.67: the previous test only proved **the event was recorded
   * + the panel did not crash**; nobody asserted that the type **actually appears in the panel's
   * visible text**. This test adds that.
   *
   * Driving method (all usable in jsdom, not a class-driven dumb list):
   * - Sections: each SectionNav item is a real `<button>` with `aria-label=<section name>`
   *   (panel.tsx:414-423, click → activeSection.value = section).
   * - Sub tabs: @vobs/ui Tabs items are `<button role="tab" data-tab-id=...>`
   *   (ui/src/tabs.ts:120-137, click → onChange → activeComponentsTab).
   * The panel's default section is updates; the Lifecycle list lives under components → lifecycle
   * sub tab, so two clicks are needed. Refresh goes through the scheduler's microtask batching
   * (reactivity/src/scheduler.ts:28-36); `settle()` is enough.
   */
  it('after switching to components → lifecycle, the event type really appears in the panel visible text', async () => {
    const devtools = createDevTools({ expose: false })
    const view = mountPanel(devtools)
    await settle()

    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    await settle()

    // precondition: the lifecycle event really exists in devtools (otherwise the assertions below are no-ops)
    const recorded = devtools.getLifecycleEvents().filter(event => event.type === 'hydration-provisional-text')
    expect(recorded).toHaveLength(1)

    const visibleText = (): string => view.host.textContent ?? ''
    const click = (selector: string): void => {
      const target = view.host.querySelector<HTMLElement>(selector)
      if (!target) throw new Error(`clickable node not found in the panel: ${selector}`)
      target.click()
    }

    // control: the default section is updates, so this type must not appear in the visible text
    expect(visibleText()).not.toContain('hydration-provisional-text')

    click('button[aria-label="components"]')
    await settle()
    // the components section defaults to the tree sub tab; the Lifecycle list is not rendered yet
    expect(view.host.querySelector('[data-tab-id="lifecycle"]')).not.toBeNull()
    expect(visibleText()).not.toContain('hydration-provisional-text')

    click('[data-tab-id="lifecycle"]')
    await settle()

    // the point: renderLifecycleTimeline renders event.type as text, so the type name must be visible
    expect(view.host.querySelector('.vobs-devtools-lifecycle-list')).not.toBeNull()
    expect(visibleText()).toContain('hydration-provisional-text')

    app.destroy()
    view.app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })
})
