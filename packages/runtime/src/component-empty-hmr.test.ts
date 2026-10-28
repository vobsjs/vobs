// @vitest-environment jsdom
/*
 * Components returning empty values must not crash on HMR refresh (the other half the
 * 1.8.0 fix missed).
 *
 * ## The defect
 *
 * `createComponent` has two render paths:
 * - **First mount** (`const node = isRenderableNode(rendered) ? … : createComment('vobs:empty')`)
 *   — 1.8.0 fixed empty return values here
 * - **HMR refresh** (`refreshInstance`, called from `hmr.ts`) — **not fixed**:
 *   `nodeOwners.set(next as object, owner)` got `null` as a WeakMap key →
 *   throws `Invalid value used as weak map key`, the same error as the 9/30 release
 *   black screen
 *
 * ## Actual consequence (graded honestly: **not a production crash**)
 *
 * `hmr.ts` wraps `instance.refresh()` in try/catch, swallowing the exception — but that
 * catch's own comment states the consequence:
 *   "Swallowing this silently would make the developer think the hot update succeeded
 *    while the screen shows the old thing — the easiest misread as 'my change didn't
 *    take effect', chased for hours"
 *
 * I.e.: **during development the code changed, the hot-update refresh failed, and the
 * screen stayed on the old version**.
 *
 * ## Goes through the real HMR path
 *
 * `resolveComponent` is used to get the HMR proxy (what compiler-injected code uses);
 * after mounting, `updateHmrModule` swaps in the new version — only then does
 * `module.instances` **really** contain an instance and `refresh()` actually get called.
 *
 * ⚠️ My first test version **did not take this path**: it called `createComponent`
 * directly + `updateHmrModule`; the instance was never registered to that moduleId, so
 * `module.instances` was empty, `refresh` never ran, the tests were green but **verified
 * nothing**. When the fix was reverted it still didn't go red, which exposed it.
 *
 * ## Also locks the type layer
 *
 * The components below do `return cond ? … : null` directly — **no type assertion, no
 * cast**. Before 1.8.3 this reported `Type 'null' is not assignable to type 'VobsNode'`.
 * The industry consensus is to allow it across the board: React's `ReactNode`, Preact's
 * `ComponentChild`, Solid's `JSX.Element`, Vue's `VNodeChild` all include
 * `null | undefined | boolean`.
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { resolveComponent, updateHmrModule } from './hmr'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('component empty returns: type layer (industry consensus, no cast needed)', () => {
  it('`return cond ? <div/> : null` needs no cast', () => {
    const open = state(true)
    function MaybeEmpty(): VobsNode | null {
      return open.value ? createElement('div') : null
    }
    expect(typeof MaybeEmpty).toBe('function')
  })

  it('early-return `if (cond) return null` likewise needs no cast', () => {
    const loading = state(false)
    function EarlyReturn() {
      if (loading.value) return null
      return createElement('div')
    }
    expect(typeof EarlyReturn).toBe('function')
  })
})

describe('component empty returns: the HMR refresh path must not crash', () => {
  const moduleId = '/src/tmp-hmr-return.tsx'

  it('a new version making the component return null → refresh does not throw, and content really becomes empty', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)

    // ① Use the HMR proxy (compiler-injected code goes through resolveComponent)
    const V1 = (): VobsNode => {
      const el = createElement('div')
      el.textContent = 'v1'
      return el
    }
    const proxied = resolveComponent(V1 as never, moduleId, 'V1')

    const app = createVobs({
      render: () => createComponent(proxied as never, {} as never) as VobsNode
    })
    app.mount(host)
    settle()
    expect(host.textContent, 'first mount rendered nothing, the assertions after this are meaningless').toBe('v1')

    // ② Swap in the new version: returns null (exactly the form that triggers the unfixed path)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        () => { updateHmrModule(moduleId, { V1: (): VobsNode | null => null }) },
        'HMR refresh threw — the exception was swallowed by hmr.ts and the screen would stay on the old version'
      ).not.toThrow()
      settle()

      // ③ Prove the refresh **really executed** (not "didn't throw because nothing ran")
      expect(
        host.textContent,
        'DOM still shows v1 after refreshing to empty — refresh never executed, this test verified nothing'
      ).toBe('')
      // A failed refresh is logged as an error by hmr.ts; success must not log one
      const logged = [...warning.mock.calls, ...error.mock.calls].map(call => String(call[0])).join('\n')
      expect(logged, `refresh left an error record: ${logged}`).not.toContain('weak map')
    } finally {
      warning.mockRestore(); error.mockRestore()
    }

    app.destroy(); host.remove()
  })
})
