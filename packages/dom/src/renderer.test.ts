import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDOMRenderer,
  setRenderer,
  createText,
  createElement,
  insertBefore,
  bindText,
  insertDynamic,
  insertList
} from './index'
import { onDispose, state } from '@vobs/reactivity'

describe('dom', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('creates a text node', () => {
    const text = createText('hello')

    expect(text.textContent).toBe('hello')
  })

  it('creates an element and inserts into it', () => {
    const parent = createElement('div')
    const child = createElement('span')
    const text = createText('内容')

    insertBefore(child, text, null)
    insertBefore(parent, child, null)

    expect(parent.innerHTML).toBe('<span>内容</span>')
  })

  it('bindText updates reactively', async () => {
    const count = state(0)
    const text = createText('')

    bindText(text, count)

    expect(text.textContent).toBe('0')

    count.value = 5
    await Promise.resolve()

    expect(text.textContent).toBe('5')
  })

  it('dynamic getters track the states they read', async () => {
    const count = state(0)
    const text = createText('')

    bindText(text, () => `count: ${count.value}`)
    count.value = 2
    await Promise.resolve()

    expect(text.textContent).toBe('count: 2')
  })

  it('creates and destroys nodes when a conditional block toggles', async () => {
    const show = state(true)
    const parent = createElement('div')
    let disposed = 0

    insertDynamic(parent, null, () => {
      if (!show.value) return null
      onDispose(() => { disposed++ })
      const child = createElement('span')
      insertBefore(child, createText('visible'), null)
      return child
    })

    expect(parent.textContent).toContain('visible')
    show.value = false
    await Promise.resolve()

    expect(parent.textContent).not.toContain('visible')
    expect(disposed).toBe(1)
  })

  it('keyed list reuses nodes, updates content and preserves order', async () => {
    const items = state([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' }
    ])
    const parent = createElement('ul')
    const created: Element[] = []

    insertList(
      parent,
      null,
      () => items.value,
      item => {
        const node = createElement('li')
        created.push(node)
        const text = createText('')
        insertBefore(node, text, null)
        bindText(text, () => item.name)
        return node
      },
      item => item.id
    )

    const first = created[0]
    items.value = [
      { id: 2, name: 'B updated' },
      { id: 1, name: 'A' }
    ]
    await Promise.resolve()

    expect(created).toHaveLength(2)
    expect(parent.children[1]).toBe(first)
    expect(parent.textContent).toContain('B updated')
  })

  it('keyed list uses the new index when reusing render items that capture index', async () => {
    const items = state([{ id: 'a' }, { id: 'b' }])
    const parent = createElement('ul')

    insertList(
      parent,
      null,
      () => items.value,
      (item, index) => {
        const node = createElement('li')
        const text = createText('')
        insertBefore(node, text, null)
        bindText(text, () => `${item.id}:${index}`)
        return node
      },
      item => item.id
    )

    items.value = [items.value[1]!, items.value[0]!]
    await Promise.resolve()

    expect(parent.textContent).toBe('b:0a:1')
  })

  it('destroys the owner when a list item is removed', async () => {
    const items = state([{ id: 1 }])
    const parent = createElement('ul')
    let disposed = false

    insertList(
      parent,
      null,
      () => items.value,
      () => {
        onDispose(() => { disposed = true })
        return createElement('li')
      },
      item => item.id
    )

    items.value = []
    await Promise.resolve()

    expect(disposed).toBe(true)
  })
})
