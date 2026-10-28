// @vitest-environment jsdom
/*
 * Regression: **a bad callback ref must not break the Owner's dispose cascade**.
 *
 * Source (end-to-end interaction smoke): in the playground's `<ul ref={attachList}>`,
 * `attachList(node)` called `insertList(node, …)` directly without null-checking. A
 * callback ref **is called with null on unmount** (React semantics), so on receiving null
 * it threw
 *   TypeError: Cannot read properties of null (reading 'insertBefore')
 * and that exception **bubbled out of `onDispose`** — so the same Owner's subsequent
 * cleanups (effect unbinding, listener removal, other ref cleanups) **all never ran**.
 *
 * Same class of defect as the already-fixed "a child Owner throwing must not break the
 * cascade" (`owner.ts:114-128`): cleanup paths must be isolated one by one; one failing
 * cleanup must not abandon the rest.
 */
import { describe, expect, it, vi } from 'vitest'
import { createOwner, effect, state } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import { createElement, insertBefore, setRef } from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('callback ref receiving null on unmount', () => {
  it('a callback ref receives the node on mount and null on Owner disposal', () => {
    const owner = createOwner()
    const el = createElement('div')
    const seen: Array<unknown> = []
    owner.run(() => { setRef(el, (value: unknown) => { seen.push(value) }) })
    expect(seen).toEqual([el])

    owner.dispose()
    // React semantics: called with null on unmount
    expect(seen).toEqual([el, null])
  })

  it('a bad callback ref (no null-check, throws on null) must not break the dispose cascade', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const owner = createOwner()
    const el = createElement('div')
    const value = state(0)
    let effectRuns = 0
    let laterCleanupRan = false

    owner.run(() => {
      // A callback ref that throws when receiving null (simulating an unchecked attachList)
      setRef(el, (node: unknown) => {
        if (node === null) throw new TypeError("Cannot read properties of null (reading 'insertBefore')")
      })
      // This effect stands for "subsequent cleanups in the same Owner"
      effect(() => { value.value; effectRuns += 1 })
      // And one cleanup that must definitely run
      owner.onDispose(() => { laterCleanupRan = true })
    })

    expect(effectRuns).toBe(1)

    // Key: dispose must not throw out because of that bad ref callback
    expect(() => owner.dispose()).not.toThrow()

    // Key: subsequent cleanups must all have run (exactly what was lost before the fix)
    expect(laterCleanupRan).toBe(true)
    value.value = 1
    await flush()
    expect(effectRuns).toBe(1)          // the effect was unbound

    // The exception must not be silent: either log it or let it bubble — here we log
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('re-pointing a ref within the same owner keeps one cleanup registration (no stale entries)', () => {
    const owner = createOwner()
    const a = createElement('div')
    const b = createElement('div')
    const target = { current: null as unknown }

    const before = owner.mark().cleanups
    owner.run(() => { setRef(a, target) })
    expect(owner.mark().cleanups - before).toBe(1)
    expect(target.current).toBe(a)

    owner.run(() => { setRef(b, target) })
    /*
     * Key: the second binding **replaces** the first registration instead of appending.
     * Before the fix this became 2 entries — on disposal they ran in reverse order, and
     * one of them's guard (`target.current !== node`) would "happen to pass" because the
     * other had already cleared the value to null, so the same ref was cleared twice.
     * Now only the latest one remains.
     */
    expect(owner.mark().cleanups - before).toBe(1)
    expect(target.current).toBe(b)

    // Clearing the ref to null on disposal is the **established semantics** (React's
    // unmount ref callback likewise receives null)
    owner.dispose()
    expect(target.current).toBeNull()
  })

  it('when re-pointed across owners, the earlier-disposed one doesn\'t overwrite the later binding\'s value', () => {
    const first = createOwner()
    const second = createOwner()
    const b = createElement('div')
    const c = createElement('div')
    const shared = { current: null as unknown }
    first.run(() => { setRef(b, shared) })
    second.run(() => { setRef(c, shared) })
    first.dispose()
    expect(shared.current).toBe(c)   // re-pointed by second; first's cleanup must not touch it
    second.dispose()
    expect(shared.current).toBeNull()
  })

  it('the same ref bound to different owners cleans up independently (no cross-removal)', () => {
    const first = createOwner()
    const second = createOwner()
    const target = { current: null as unknown }
    const a = createElement('div')
    const b = createElement('div')
    first.run(() => { setRef(a, target) })
    second.run(() => { setRef(b, target) })
    second.dispose()
    expect(target.current).toBeNull()
    // first's registration must still exist (belongs to another owner); disposal cleans it as usual
    first.dispose()
    expect(target.current).toBeNull()
  })

  it('after the node a ref pointed to is removed, later inserts must not get a null parent', () => {
    const host = createElement('div')
    const list = createElement('ul')
    insertBefore(host, list, null)
    // The null-checked form (the playground's shape after the fix)
    const attach = (node: Element | null): void => {
      if (!node) return
      const li = createElement('li')
      insertBefore(node, li, null)
    }
    attach(list)
    expect(list.children.length).toBe(1)
    expect(() => attach(null)).not.toThrow()
  })
})
