// @vitest-environment jsdom
/*
 * Runtime core invariant checks.
 *
 *   I2 Owner scope      — after a node/subtree leaves the document tree, the effects it
 *                         established must stop running; when a structural block is
 *                         replaced, the discarded round's effects must be released wholesale
 *   I4 channel semantics — the attribute and property channels must match their declared
 *                         semantics
 *   I3 node identity    — unrelated updates must not rebuild nodes
 *
 * The criteria always use **observable behavior** (does the effect still run, did the DOM
 * change), never internal fields.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createOwner, effect, state, type Owner } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import {
  bindAttribute,
  bindProperty,
  bindText,
  clear,
  createElement,
  createText,
  insertBefore,
  insertDynamic,
  insertDynamicValue,
  insertList,
  removeAttribute,
  setAttribute,
  setStaticProps
} from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

let liveOwners: Owner[] = []
const makeOwner = (): Owner => { const o = createOwner(); liveOwners.push(o); return o }
afterEach(() => {
  for (const o of liveOwners) { try { o.dispose() } catch { /* already disposed */ } }
  liveOwners = []
})

describe('I2 · subscription boundary between structural effects and inner effects', () => {
  /*
   * ⚠️ Records a **falsified hypothesis** so nobody "rediscovers" it later:
   *
   * It was suspected that `insertDynamic`'s `next === current` early return leaves orphan
   * block Owners (the audit report said so too). Falsified by measurement: the
   * `effect(…)` call inside the factory executes **synchronously**, and at that moment
   * the current subscriber is already that inner effect itself, so signals read in the
   * factory body are **subscribed only by the inner effect**; the outer structural
   * effect doesn't subscribe to them at all
   * → when the signal changes the outer effect doesn't re-run → no new block is created.
   * Debug hooks confirmed: one evaluation produces a single `dependencyTracked(inner
   * effect)`, and after a write only the inner effect is invalidated.
   *
   * This is correct behavior for the run-once model, not a defect. The tests below pin
   * it down behaviorally.
   */
  it('structural effects must not subscribe to signals "read only by an inner effect"', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const stable = createElement('span')
    const inner = state(0)
    let factoryCalls = 0
    let innerRuns = 0

    owner.run(() => {
      insertDynamic(parent, null, () => {
        factoryCalls += 1
        effect(() => { inner.value; innerRuns += 1 })
        return stable
      })
    })
    await flush()
    expect(factoryCalls).toBe(1)
    expect(innerRuns).toBe(1)

    for (let i = 1; i <= 3; i++) { inner.value = i; await flush() }

    // The inner effect runs every round; the structural effect must not re-run even once
    // (otherwise structural blocks are rebuilt for nothing)
    expect(innerRuns).toBe(4)
    expect(factoryCalls).toBe(1)
  })

  it('signals the factory **itself** reads must re-run the structural effect (control group)', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const which = state('a')
    let factoryCalls = 0

    owner.run(() => {
      insertDynamic(parent, null, () => {
        factoryCalls += 1
        return createElement(which.value === 'a' ? 'span' : 'b')
      })
    })
    await flush()
    expect(factoryCalls).toBe(1)
    which.value = 'b'
    await flush()
    expect(factoryCalls).toBe(2)
  })

  it('on insertDynamicValue replacement, effects established by the discarded round must stop', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const which = state(1)
    const noise = state(0)
    const runsByRound = [0, 0]

    owner.run(() => {
      insertDynamicValue(parent, null, () => {
        const round = which.value - 1
        effect(() => { noise.value; runsByRound[round] += 1 })
        return createElement('span')
      })
    })
    await flush()
    expect(runsByRound).toEqual([1, 0])

    which.value = 2          // switch to round 2 → round 1's block must be disposed
    await flush()
    expect(runsByRound[1]).toBe(1)

    // Key criterion: round 1's effect must not be woken again (otherwise it's a ghost subscription)
    const round1Before = runsByRound[0]
    noise.value = 1
    await flush()
    expect(runsByRound[0]).toBe(round1Before)
    expect(runsByRound[1]).toBe(2)
  })
})

describe('I2 · unmounting must stop the effects the subtree established', () => {
  it('after owner.dispose(), effects in the subtree must not run again', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const value = state(0)
    let runs = 0
    owner.run(() => {
      const el = createElement('div')
      insertBefore(parent, el, null)
      const text = createText('')
      bindText(text, () => { value.value; runs += 1; return 'x' })
      insertBefore(el, text, null)
    })
    await flush()
    value.value = 1
    await flush()
    const before = runs
    owner.dispose()
    value.value = 2
    await flush()
    expect(runs).toBe(before)
  })

  it('clear() must not throw and empties the container', () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    owner.run(() => {
      insertBefore(parent, createElement('section'), null)
    })
    expect(parent.children.length).toBe(1)
    expect(() => clear(parent)).not.toThrow()
    expect(parent.children.length).toBe(0)
  })
})

describe('I4 · semantics of the attribute and property channels', () => {
  it('false on the attribute channel does not set the attribute', () => {
    const el = createElement('div')
    setStaticProps(el, { title: false, draggable: false })
    expect(el.hasAttribute('title')).toBe(false)
    expect(el.hasAttribute('draggable')).toBe(false)
  })

  it('false on the property channel clears the property (disabled/checked)', () => {
    const input = createElement('input') as HTMLInputElement
    setStaticProps(input, { disabled: true, checked: true })
    expect(input.disabled).toBe(true)
    expect(input.checked).toBe(true)
    setStaticProps(input, { disabled: false, checked: false })
    expect(input.disabled).toBe(false)
    expect(input.checked).toBe(false)
  })

  it('binding an attribute to null/undefined does not write the literal "undefined"', async () => {
    const owner = makeOwner()
    const el = createElement('input')
    const value = state<string | undefined>(undefined)
    owner.run(() => { bindAttribute(el, 'placeholder', () => value.value) })
    await flush()
    expect(el.hasAttribute('placeholder')).toBe(false)
    value.value = 'hi'
    await flush()
    expect(el.getAttribute('placeholder')).toBe('hi')
  })

  it('removeAttribute really removes the attribute', () => {
    const el = createElement('div')
    setAttribute(el, 'title', 'x')
    expect(el.hasAttribute('title')).toBe(true)
    removeAttribute(el, 'title')
    expect(el.hasAttribute('title')).toBe(false)
  })
})

describe('I3 · node identity: unrelated updates must not rebuild nodes', () => {
  it('bindProperty only changes the value, never the node', async () => {
    const owner = makeOwner()
    const input = createElement('input') as HTMLInputElement
    const value = state('a')
    owner.run(() => { bindProperty(input, 'value', () => value.value) })
    await flush()
    const identity = input
    value.value = 'b'
    await flush()
    expect(input).toBe(identity)
    expect(input.value).toBe('b')
  })

  it('insertList appends must not rebuild existing rows (keyed)', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const rows = state([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    owner.run(() => {
      insertList(
        parent,
        null,
        () => rows.value,
        (item: { id: string }) => {
          const el = createElement('div')
          setAttribute(el, 'data-id', item.id)
          return el
        },
        (item: { id: string }) => item.id
      )
    })
    await flush()
    const before = [...parent.children]
    expect(before).toHaveLength(3)

    rows.value = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    await flush()
    const after = [...parent.children]
    expect(after).toHaveLength(4)
    // The first three rows must keep their identity (only the appended row is new)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })
})
