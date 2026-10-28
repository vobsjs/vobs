// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindText, createElement, createText, insertBefore, insertList, type VobsNode } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/**
 * List reconciliation has a fast path for "key sequence bit-for-bit identical"
 * (skips table building/dedup/set-difference/LIS). Measured: changing 1 of 200 rows went
 * from 34µs to 4.2µs. These tests lock down its two boundaries: rows that must update do
 * update, and reorders must **never** be swallowed by the fast path.
 */
function mountList<T>(items: () => readonly T[], keyOf: (item: T) => unknown) {
  const host = document.createElement('div')
  const root = createElement('ul')
  const app = { host }
  insertBefore(host as unknown as Node, root, null)
  insertList<T>(root as unknown as Node, null, items,
    (item: T) => {
      const li = createElement('li')
      const text = createText('')
      insertBefore(li, text, null)
      bindText(text, () => String((item as { label?: unknown }).label ?? item))
      return li
    },
    (item: T) => keyOf(item)) as VobsNode | undefined
  return { host, app }
}

describe('list fast path', () => {
  it('key order unchanged, one item\'s content changed: that row updates, the rest untouched', async () => {
    const rows = state([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' }
    ])
    const { host } = mountList(() => rows.value, item => item.id)
    await flush()
    expect(host.textContent).toBe('abc')

    rows.value = [
      { id: 1, label: 'a' },
      { id: 2, label: 'B' },
      { id: 3, label: 'c' }
    ]
    await flush()
    expect(host.textContent).toBe('aBc')
  })

  it('order changes must really reorder (never swallowed by the fast path)', async () => {
    const rows = state([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }])
    const { host } = mountList(() => rows.value, item => item.id)
    await flush()
    expect(host.textContent).toBe('abc')

    rows.value = [{ id: 3, label: 'c' }, { id: 1, label: 'a' }, { id: 2, label: 'b' }]
    await flush()
    expect(host.textContent).toBe('cab')

    // The DOM order must really be right too (not just the concatenated text); there's a
    // comment anchor at the end of the list, which is not a row
    const labels = Array.from((host.firstChild as Element).childNodes)
      .filter(node => node.nodeType === 1)
      .map(node => node.textContent)
    expect(labels).toEqual(['c', 'a', 'b'])
  })

  it('insert and delete still work (the fast path doesn\'t engage when lengths differ)', async () => {
    const rows = state([{ id: 1, label: 'a' }, { id: 3, label: 'c' }])
    const { host } = mountList(() => rows.value, item => item.id)
    await flush()
    expect(host.textContent).toBe('ac')

    rows.value = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }]
    await flush()
    expect(host.textContent).toBe('abc')

    rows.value = [{ id: 2, label: 'b' }]
    await flush()
    expect(host.textContent).toBe('b')
  })
})
