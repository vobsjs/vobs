// @vitest-environment jsdom
/*
 * A component returning `null` / `undefined` / `false` **must not crash the App**.
 *
 * This is the root cause of a production incident (Labelune 2026-09-30 release black
 * screen): `createComponent` used the render result directly as a **WeakMap key** for
 * `nodeOwners`, but `null` / `undefined` are not legal keys → throws
 * `Invalid value used as weak map key`. The most expensive part was the **diagnostics**:
 * the App crashed at mount, with no JS crash log at all, and even the splash fallback failed.
 *
 * "Conditional return null at the top of a component" (`cond ? <X/> : null`,
 * `cond && <X/>`) is a legal JSX form. Fix: normalize into an **empty comment node** —
 * visually empty (identical to returning null) while satisfying the `VobsNode` contract,
 * so mounting / HMR refresh / node replacement / hydration don't each need a special-case
 * "empty" branch.
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { insertDynamic } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

function mount(render: () => VobsNode) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ render })
  app.mount(host)
  return { host, app, cleanup: () => { app.destroy(); host.remove() } }
}

describe('component empty returns no longer crash', () => {
  it('top-level return null → no throw, renders empty', () => {
    const Cond = (props: { on: boolean }): VobsNode =>
      (props.on ? createText('yes') : null) as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Cond, { on: false })) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('return undefined → no throw, renders empty', () => {
    const Blank = (): VobsNode => undefined as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Blank, {})) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('return false (the `cond && <X/>` form) → no throw, renders empty', () => {
    const Maybe = (props: { on: boolean }): VobsNode =>
      (props.on && createText('yes')) as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Maybe, { on: false })) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('renders normally when cond is true (the feature wasn\'t killed along with the fix)', () => {
    const Cond = (props: { on: boolean }): VobsNode =>
      (props.on ? createText('yes') : null) as unknown as VobsNode
    const view = mount(() => createComponent(Cond, { on: true }))
    expect(view.host.textContent).toBe('yes')
    view.cleanup()
  })

  it('siblings render normally when a null-returning component is **nested mid-tree**', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => {
      const wrap = document.createElement('div')
      wrap.append(document.createTextNode('before'))
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.append(document.createTextNode('after'))
      return wrap as unknown as VobsNode
    })
    expect(view.host.textContent).toBe('beforeafter')
    view.cleanup()
  })

  it('conditional factory switches between null ↔ node (reactive)', () => {
    const on = state(false)
    /*
     * Note this uses `createBlock` (the conditional factory), not
     * `createComponent(..., { on: on.value })`. The latter **violates the run-once
     * contract**: the component body and render execute only once, so reading the signal
     * in the outer render neither subscribes nor re-runs (exactly the discipline of item
     * B in the doc). Structural changes must be carried by a conditional factory or a
     * binding effect — the reactivity comes from the factory driven by `insertDynamic`;
     * `createBlock` is just "the factory that rebuilds every time".
     */
    const view = mount(() => {
      const wrap = document.createElement('div')
      insertDynamic(wrap as unknown as Node, null, () => (on.value ? createText('shown') : null))
      return wrap as unknown as VobsNode
    })

    expect(view.host.textContent).toBe('')
    on.value = true
    settle()
    expect(view.host.textContent, 'did not render after switching to the node').toBe('shown')
    on.value = false
    settle()
    expect(view.host.textContent, 'did not clear after switching back to null').toBe('')
    view.cleanup()
  })

  it('destroying a null-returning component does not throw (Owner released normally)', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => createComponent(Blank, {}))
    expect(() => view.app.destroy()).not.toThrow()
    view.host.remove()
  })

  it('several null-returning components coexist', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => {
      const wrap = document.createElement('div')
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      return wrap as unknown as VobsNode
    })
    expect(view.host.textContent).toBe('')
    expect(() => view.cleanup()).not.toThrow()
  })
})
