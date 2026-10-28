// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import type { Signal } from '@vobs/vobs'
import { effect, createOwner, state } from '@vobs/reactivity'
import { addEventListener, createElement, removeEventListener } from './index'

describe('event binding dedupe', () => {
  it('replaces a previous binding for the same node and event', () => {
    setRenderer(createDOMRenderer())
    const node = createElement('button')
    let first = 0
    let second = 0
    const firstHandler = (): void => { first++ }
    const secondHandler = (): void => { second++ }
    addEventListener(node, 'click', firstHandler)
    addEventListener(node, 'click', secondHandler)
    node.dispatchEvent(new MouseEvent('click'))
    expect(first).toBe(0)
    expect(second).toBe(1)
    /*
     * The **currently bound** handler must be passed here.
     *
     * It used to pass an unrelated `() => undefined` and expect the removal to still
     * happen — that would have codified "ignore handler identity" as a contract. The
     * DOM's `removeEventListener` semantics only detach when `(type, listener, capture)`
     * all match; calling with a different listener is a **no-op**.
     *
     * Real callers (`ops.ts:339`/`:368`) pass exactly the accurate `previousHandler`, so
     * assert per real usage; "passing the wrong handler must not mistakenly detach" is
     * specifically locked down by `remove-listener-identity.test.ts`.
     */
    removeEventListener(node, 'click', secondHandler)
    node.dispatchEvent(new MouseEvent('click'))
    expect(second).toBe(1)
  })

  it('signals created inside event handlers survive owner disposal', async () => {
    // Semantic lock: addEventListener wraps compiled event handlers in owner.run
    // (error routing + detached-DOM protection). A state created inside a handler is
    // application data and must remain writable after the scope is destroyed.
    // Regression background: a dropdown closing destroyed its scope and took with it the
    // element signal created by a menu click, causing "elements can't be moved/resized"
    // (set silently ineffective).
    setRenderer(createDOMRenderer())
    const owner = createOwner()
    const node = createElement('button')

    let created: Signal<number> | null = null
    owner.run(() => {
      addEventListener(node, 'click', () => {
        if (created === null) created = state(0, 'handler.created')
        created.set(created.value + 1)
      })
    })

    node.dispatchEvent(new MouseEvent('click'))
    node.dispatchEvent(new MouseEvent('click'))
    expect(created).not.toBeNull()
    expect(created!.value).toBe(2)

    // Scope destroyed (e.g. menu closed): detached-DOM protection keeps working — events no longer reach the handler
    owner.dispose()
    node.dispatchEvent(new MouseEvent('click'))
    expect(created!.value).toBe(2)

    // But the signal itself survives: still writable, still subscribable by new effects (data lifetime = reachability)
    const seen: number[] = []
    effect(() => { seen.push(created!.value) })
    created!.set(7)
    await Promise.resolve()
    expect(created!.value).toBe(7)
    expect(seen).toEqual([2, 7])
  })
})
