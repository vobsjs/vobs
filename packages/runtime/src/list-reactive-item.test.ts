// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindText, createElement, createText, insertBefore, insertList, type VobsNode } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/**
 * `insertList`'s renderItem receives a "reactive item proxy": property reads are forwarded
 * to the item signal, so the row's effect can read the new entry after a same-key
 * replacement.
 *
 * This proxy's target used to be the **entry as of creation time**. As soon as an entry
 * was Object.freeze'd (@vobs/notification freezes every notification), the target kept
 * "non-configurable, non-writable" own properties, and the get trap returning the new
 * value violated the Proxy invariant — measured, it throws outright:
 *
 *   TypeError: 'get' on proxy: property 'label' is a read-only and non-configurable data
 *   property on the proxy target but the proxy did not return its actual value
 *
 * So frozen entries' rows could not be refreshed in place at all. On first render
 * item.value === target, same value, so nothing showed.
 */
describe('insertList\'s reactive item proxy', () => {
  function mount<T>(rows: { value: readonly T[] }, keyOf: (item: T) => unknown) {
    const host = document.createElement('div')
    const root = createElement('ul')
    insertBefore(host as unknown as Node, root, null)
    const captured: T[] = []
    let node: VobsNode | null = null
    insertList<T>(root as unknown as Node, null, () => rows.value, item => {
      captured.push(item)
      const li = createElement('li')
      const text = createText('')
      insertBefore(li, text, null)
      // Read the entry inside an effect: must get the new value after replacement
      bindText(text, () => String((item as { label?: unknown }).label ?? item))
      node = li
      return li
    }, keyOf)
    return { host, captured, getNode: () => node }
  }

  it('after a frozen entry is replaced, the row effect reads the new value and the row is reused in place', async () => {
    const rows = state<readonly { id: number; label: string }[]>([Object.freeze({ id: 1, label: 'a' })])
    const { host, getNode, captured } = mount(rows, (item: { id: number }) => item.id)
    await flush()
    expect(host.textContent).toBe('a')
    const first = getNode()

    rows.value = [Object.freeze({ id: 1, label: 'b' })]
    await flush()

    expect(host.textContent).toBe('b')          // before the fix this line threw a TypeError outright
    expect(getNode()).toBe(first)               // keyed reconcile: the same DOM row
    // Frozen entry's descriptor invariant: Object.keys / spread / in must not throw either
    const item = captured[captured.length - 1] as { id: number; label: string }
    expect(Object.keys(item)).toEqual(['id', 'label'])
    expect({ ...item }).toEqual({ id: 1, label: 'b' })
    expect('label' in item).toBe(true)
  })

  it('unfrozen entries and array entries keep their original semantics (prototype / Array.isArray / length)', async () => {
    class Row {
      constructor(readonly label: string) {}
    }
    const rows = state<readonly unknown[]>([new Row('x'), [1, 2, 3]])
    const { host, captured } = mount(rows, (item: unknown) => item)
    await flush()
    expect(host.textContent).toBe('x1,2,3')

    const row = captured[0]
    const list = captured[1]
    expect(row).toBeInstanceOf(Row)
    expect(Array.isArray(list)).toBe(true)
    expect((list as readonly number[]).length).toBe(3)
  })
})
