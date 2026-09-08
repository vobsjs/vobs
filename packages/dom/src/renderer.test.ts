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

  it('创建文本节点', () => {
    const text = createText('hello')

    expect(text.textContent).toBe('hello')
  })

  it('创建元素并插入', () => {
    const parent = createElement('div')
    const child = createElement('span')
    const text = createText('内容')

    insertBefore(child, text, null)
    insertBefore(parent, child, null)

    expect(parent.innerHTML).toBe('<span>内容</span>')
  })

  it('bindText 响应式更新', async () => {
    const count = state(0)
    const text = createText('')

    bindText(text, count)

    expect(text.textContent).toBe('0')

    count.value = 5
    await Promise.resolve()

    expect(text.textContent).toBe('5')
  })

  it('动态 getter 会追踪读取到的 state', async () => {
    const count = state(0)
    const text = createText('')

    bindText(text, () => `count: ${count.value}`)
    count.value = 2
    await Promise.resolve()

    expect(text.textContent).toBe('count: 2')
  })

  it('条件块切换时创建和销毁节点', async () => {
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

  it('keyed 列表复用节点、更新内容并保留顺序', async () => {
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

  it('keyed 列表在复用带 index 的渲染项时使用新索引', async () => {
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

  it('列表项删除时销毁其 Owner', async () => {
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
