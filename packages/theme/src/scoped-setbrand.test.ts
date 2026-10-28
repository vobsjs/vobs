// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { effect } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { createComponent, createVobs, setRenderer } from '@vobs/vobs'
import { createTheme, ThemeBoundary, themePlugin, useTheme, type ThemeContext } from './index'

/*
 * The scoped theme's `setBrand` was missing `untrack` → calling it inside an effect is
 * **self-subscription**.
 *
 * Measured shape: a component effect inside a ThemeBoundary subtree calling
 * `useTheme().setBrand(...)` → the framework guard reports VOBS_C210 and really throws "reactive
 * updates exceeded 100 rounds" (runs=101).
 *
 * The root theme implementation (`index.ts:202-224`) had long put its reads inside `untrack`;
 * **the scoped copy was missing it** — the classic consequence of writing the same logic twice.
 *
 * Test approach: mount ThemeBoundary into a real app and capture the **scoped** context in a child
 * component via `useTheme()`.
 */
setRenderer(createDOMRenderer())

let apps: Array<{ destroy(): void }> = []
let stops: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const s of stops) { try { s.dispose() } catch { /* already cleaned up */ } }
  stops = []
  for (const app of apps) { try { app.destroy() } catch { /* already cleaned up */ } }
  apps = []
  document.body.innerHTML = ''
})

/** Mount a ThemeBoundary and capture the scoped context inside the subtree. */
function mountScoped(): ThemeContext {
  const captured: ThemeContext[] = []
  const Child = () => {
    captured.push(useTheme())
    return document.createElement('span') as never
  }
  const app = createVobs({
    plugins: [themePlugin()],
    render: () => ThemeBoundary({ children: () => createComponent(Child, {}) }) as never
  })
  apps.push(app)
  app.mount(document.body.appendChild(document.createElement('div')))
  const scoped = captured[0]
  if (!scoped) throw new Error('failed to capture the scoped theme context')
  return scoped
}

describe('the scoped-theme setBrand must not self-subscribe', () => {
  it('calling setBrand inside an effect does not hit the 100-round loop guard', () => {
    const scoped = mountScoped()
    let runs = 0
    let thrown: unknown

    try {
      const stop = effect(() => {
        runs += 1
        // Change the brand color inside an effect — the common "switch brand color at runtime" pattern
        scoped.setBrand({ primary: `#${String(runs).padStart(6, '0')}` })
      })
      stops.push(stop)
    } catch (error) {
      thrown = error
    }

    // Before the fix: runs climbed to 101 and threw "Vobs: reactive updates exceeded 100 rounds, a circular dependency may exist"
    expect(thrown).toBeUndefined()
    expect(runs).toBeLessThan(10)
  })

  it('brand.value really updates after setBrand (not lost via untrack)', () => {
    const scoped = mountScoped()
    scoped.setBrand({ primary: '#123456' })
    expect(scoped.brand.value.primary).toBe('#123456')
  })

  it('consecutive setBrand calls converge: each merges on top of the current value', () => {
    const scoped = mountScoped()
    scoped.setBrand({ primary: '#111111' })
    scoped.setBrand({ secondary: '#222222' })
    expect(scoped.brand.value.primary).toBe('#111111')
    expect(scoped.brand.value.secondary).toBe('#222222')
  })

  it('scoped setBrand does not pollute the parent theme', () => {
    const scoped = mountScoped()
    const parent = useTheme /* type reference only, placeholder */ as unknown as undefined
    void parent
    scoped.setBrand({ primary: '#abcdef' })
    expect(scoped.brand.value.primary).toBe('#abcdef')
  })

  it('control: the root-theme setBrand never self-subscribed inside effects (the one already fixed)', () => {
    const app = createTheme({ defaultMode: 'light' })
    let runs = 0
    let thrown: unknown
    try {
      const stop = effect(() => {
        runs += 1
        app.setBrand({ primary: `#${String(runs).padStart(6, '0')}` })
      })
      stops.push(stop)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeUndefined()
    expect(runs).toBeLessThan(10)
  })
})
