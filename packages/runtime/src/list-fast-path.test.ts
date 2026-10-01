// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindText, createElement, createText, insertBefore, insertList, type VobsNode } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/**
 * 列表调和里有一条「key 序列逐位相同」的快路径（跳过建表/去重/差集/LIS）。
 * 实测 200 行只改 1 行从 34µs 降到 4.2µs。这些测试锁住它的两条边界：
 * 该更新的行必须更新，该重排的时候**绝不能**被快路径吞掉。
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

describe('列表快路径', () => {
  it('key 顺序不变、只有一项内容变了：那一行更新，其余不动', async () => {
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

  it('顺序变化必须真的重排（不能被快路径吞掉）', async () => {
    const rows = state([{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }])
    const { host } = mountList(() => rows.value, item => item.id)
    await flush()
    expect(host.textContent).toBe('abc')

    rows.value = [{ id: 3, label: 'c' }, { id: 1, label: 'a' }, { id: 2, label: 'b' }]
    await flush()
    expect(host.textContent).toBe('cab')

    // DOM 顺序也要真的对（不只是文本拼接结果）；列表末尾有个注释锚点，不是行
    const labels = Array.from((host.firstChild as Element).childNodes)
      .filter(node => node.nodeType === 1)
      .map(node => node.textContent)
    expect(labels).toEqual(['c', 'a', 'b'])
  })

  it('插入与删除仍然正常（长度不同时快路径不参与）', async () => {
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
