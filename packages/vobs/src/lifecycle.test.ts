// @vitest-environment jsdom
/*
 * `onMount` — the client-side lifecycle primitive.
 *
 * Why it exists (external pitfall doc item D + the capability coverage analysis
 * "lifecycle: zero coverage"): timers, `matchMedia`, `localStorage`, measuring element
 * sizes — the client-only things — previously had **no official place**; apps had to
 * hand-write `typeof window !== 'undefined'`, or call directly in the component body
 * (and blow up or leak during prerender).
 *
 * Semantics consistent with run-once: **runs once after the mount's synchronous work
 * finishes**, not on every render.
 */
import { describe, expect, it, vi } from 'vitest'
import { createOwner, onDispose } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { onDestroy, onMount } from './index'

setRenderer(createDOMRenderer())

/** Wait for microtasks (onMount defers via microtask until after mount). */
const flushMicrotasks = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

describe('onMount', () => {
  it('runs once after the component mounts, with the DOM already in the document', async () => {
    let mountedAtCall: boolean | null = null
    let runs = 0
    const Comp = (): VobsNode => {
      const el = createElement('div')
      onMount(() => {
        runs += 1
        // Key: the callback can read "already mounted into the document", so measuring / focus / matchMedia work
        mountedAtCall = el.isConnected
      })
      return el
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)

    await flushMicrotasks()
    expect(runs).toBe(1)
    expect(mountedAtCall, 'the node was not yet in the document when onMount ran').toBe(true)

    await flushMicrotasks()
    expect(runs, 'onMount should not run twice').toBe(1)
    app.destroy()
    host.remove()
  })

  it('component unmounted before the microtask → callback does not run (leak prevention)', async () => {
    const spy = vi.fn()
    const Comp = (): VobsNode => {
      onMount(spy)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    app.destroy()                  // unmount immediately, before the microtask

    await flushMicrotasks()
    expect(spy, 'onMount of an already-unmounted component still ran (would leak timers/listeners)').not.toHaveBeenCalled()
    host.remove()
  })

  it('called outside an Owner → executes immediately, not silently dropped', () => {
    const spy = vi.fn()
    onMount(spy)
    expect(spy, 'onMount was silently dropped without an Owner').toHaveBeenCalledTimes(1)
  })

  it('the returned cancel function can cancel before execution', async () => {
    const spy = vi.fn()
    const Comp = (): VobsNode => {
      const cancel = onMount(spy)
      cancel()
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    await flushMicrotasks()
    expect(spy).not.toHaveBeenCalled()
    app.destroy()
    host.remove()
  })

  it('works inside a plain Owner (effect scope) too', async () => {
    const spy = vi.fn()
    const owner = createOwner()
    owner.run(() => { onMount(spy) })
    expect(spy).not.toHaveBeenCalled()      // microtask not reached yet
    await flushMicrotasks()
    expect(spy).toHaveBeenCalledTimes(1)
    owner.dispose()
  })

  it('passing a non-function → throws (not silently)', () => {
    expect(() => onMount(undefined as never)).toThrowError(/function/u)
  })

  it('does not run without document (Node-side prerender)', async () => {
    const spy = vi.fn()
    const originalDocument = globalThis.document
    // Simulate the Node side: remove document
    // @ts-expect-error deliberately deleted to simulate a DOM-less environment
    delete globalThis.document
    try {
      const owner = createOwner()
      owner.run(() => { onMount(spy) })
      await flushMicrotasks()
      expect(spy, 'the client callback ran during prerender').not.toHaveBeenCalled()
      owner.dispose()
    } finally {
      globalThis.document = originalDocument
    }
  })
})

describe('onDestroy — paired with onMount', () => {
  it('runs on unmount', async () => {
    const cleaned = vi.fn()
    const Comp = (): VobsNode => {
      onDestroy(cleaned)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    expect(cleaned).not.toHaveBeenCalled()
    app.destroy()
    expect(cleaned, 'onDestroy did not run on unmount').toHaveBeenCalledTimes(1)
    host.remove()
  })

  it('paired with onMount: start a timer after mount, clear it on unmount (the hero carousel shape from item D)', async () => {
    const timer = { id: 0 }
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    try {
      const Comp = (): VobsNode => {
        onMount(() => { timer.id = setInterval(() => { /* tick */ }, 5000) as unknown as number })
        onDestroy(() => { clearInterval(timer.id) })
        return createElement('div')
      }
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createComponent(Comp, {}) })
      app.mount(host)
      // onMount is a microtask: must wait for it to run before asserting the timer started
      await flushMicrotasks()

      expect(setSpy, 'no timer was started in onMount').toHaveBeenCalled()
      expect(clearSpy, 'cleared during mount (wrong timing)').not.toHaveBeenCalled()

      app.destroy()
      expect(clearSpy, 'onDestroy did not clear the timer (would leak)').toHaveBeenCalledWith(timer.id)
      host.remove()
    } finally {
      setSpy.mockRestore(); clearSpy.mockRestore()
    }
  })

  it('called outside an Owner → throws (not silently dropped; that would become the hardest-to-trace leak)', () => {
    expect(() => onDestroy(() => undefined)).toThrowError(/component/u)
  })

  it('passing a non-function → throws', () => {
    const owner = createOwner()
    owner.run(() => {
      expect(() => onDestroy(undefined as never)).toThrowError(/function/u)
    })
    owner.dispose()
  })

  it('one failing cleanup does not stop the rest (same isolation as onDispose)', () => {
    const order: string[] = []
    const owner = createOwner()
    owner.run(() => {
      onDestroy(() => { order.push('first') })
      onDestroy(() => { order.push('throw'); throw new Error('boom') })
      onDestroy(() => { order.push('last') })
    })
    // owner.dispose rethrows the first error (existing owner.ts semantics), but all other cleanups ran
    expect(() => owner.dispose()).toThrowError('boom')
    expect(order, 'one failing cleanup lost the later cleanups').toEqual(['last', 'throw', 'first'])
  })

  it('behaves identically to onDispose (one operation, two names)', async () => {
    const viaDestroy = vi.fn()
    const viaDispose = vi.fn()
    const Comp = (): VobsNode => {
      onDestroy(viaDestroy)
      onDispose(viaDispose)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    app.destroy()
    expect(viaDestroy).toHaveBeenCalledTimes(1)
    expect(viaDispose).toHaveBeenCalledTimes(1)
    host.remove()
  })
})
