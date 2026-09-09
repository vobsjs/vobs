// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, createText, insertDynamicValue, insertList, createComponent } from '@vobs/vobs'
import { effect, state } from '@vobs/reactivity'
import { bindText } from './bind'
import { createFragment, type VobsNode } from './fragment'

describe('dynamic JSX child normalization', () => {
  it('ignores empty conditional values and expands arrays without a wrapper', () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    insertDynamicValue(parent, null, () => [createText('a'), false, null, createText('b')])
    expect(parent.textContent).toBe('ab')
    expect(parent.querySelector('vobs-value')).toBeNull()
  })

  it('formats primitive children and nested arrays without stringifying booleans', () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    insertDynamicValue(parent, null, () => ['hello', false, [' ', 2]])
    expect(parent.textContent).toBe('hello 2')
  })

  it('renders null, undefined and booleans as empty text', () => {
    setRenderer(createDOMRenderer())
    const node = document.createTextNode('')
    const parent = document.createElement('div')
    parent.append(node)
    bindText(node, () => false)
    expect(parent.textContent).toBe('')
  })
})

describe('array dynamic child disposal', () => {
  it('disposes inner component owners when the array is swapped', async () => {
    setRenderer(createDOMRenderer())
    const log: string[] = []
    let mountCount = 0
    function Inner(): Node {
      // 按实例打标：数组替换后新组件的 effect 也会合法运行，不能共享计数
      const instance = ++mountCount
      effect(() => {
        log.push(`run:${instance}`)
        return () => log.push(`cleanup:${instance}`)
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    const items = state([1])
    insertDynamicValue(parent, null, () => items.value.map(() => createComponent(Inner, {})))
    expect(log).toEqual(['run:1'])

    items.value = [2]
    await new Promise(resolve => setTimeout(resolve, 0))
    // 旧组件的 effect 必须被清理，而不是继续订阅信号写已脱离的 DOM
    expect(log).toContain('cleanup:1')
    expect(log).toContain('run:2')
    expect(log).not.toContain('cleanup:2')
  })

  it('disposed inner effects stop reacting to their signals', async () => {
    setRenderer(createDOMRenderer())
    const counter = state(0)
    interface Instance {
      runs: number
      disposed: boolean
    }
    const mounted: Instance[] = []
    function Inner(): Node {
      const instance: Instance = { runs: 0, disposed: false }
      mounted.push(instance)
      effect(() => {
        counter.value
        instance.runs++
        return () => { instance.disposed = true }
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    const items = state([1])
    insertDynamicValue(parent, null, () => items.value.map(() => createComponent(Inner, {})))
    const first = mounted[0]
    expect(first.runs).toBe(1)

    items.value = [2]
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(first.disposed).toBe(true)

    counter.value = 1
    await new Promise(resolve => setTimeout(resolve, 0))
    // 幽灵 effect 不允许再被触发
    expect(first.runs).toBe(1)
  })

  it('disposes multi-root components nested in swapped arrays', async () => {
    setRenderer(createDOMRenderer())
    const log: string[] = []
    function MultiRoot(): VobsNode {
      effect(() => {
        log.push('run')
        return () => log.push('cleanup')
      })
      const first = document.createElement('span')
      const second = document.createElement('span')
      return createFragment((parent, anchor) => {
        parent.insertBefore(first, anchor)
        parent.insertBefore(second, anchor)
      })
    }
    const parent = document.createElement('div')
    const items = state([1])
    insertDynamicValue(parent, null, () => items.value.map(() => createComponent(MultiRoot, {})))
    items.value = [2]
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toContain('cleanup')
  })
})

describe('primitive list item updates', () => {
  // 模拟编译产物：{item} 编译为 insertDynamicValue(() => item)，
  // 原始值被静态捕获，不订阅 item 信号。
  function compiledRow(item: string): Node {
    const span = document.createElement('span')
    const text = document.createTextNode('')
    span.append(text)
    insertDynamicValue(span, null, () => item)
    return span
  }

  function loggedRow(item: string, log: string[]): Node {
    const span = document.createElement('span')
    const text = document.createTextNode('')
    span.append(text)
    effect(() => {
      log.push(`run:${item}`)
      return () => log.push(`cleanup:${item}`)
    })
    insertDynamicValue(span, null, () => item)
    return span
  }

  it('updates indexed rows when primitive items change', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const items = state(['a', 'b'])
    insertList(parent, null, () => items.value, item => compiledRow(item))
    expect(parent.textContent).toBe('ab')

    items.value = ['a', 'c']
    await new Promise(resolve => setTimeout(resolve, 0))
    // 原始类型项无法通过 item 信号刷新视图，必须重建该行
    expect(parent.textContent).toBe('ac')
  })

  it('updates keyed rows when the value changes under a stable key', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const items = state(['a', 'b'])
    insertList(parent, null, () => items.value, item => compiledRow(item), (_item, index) => index)
    expect(parent.textContent).toBe('ab')

    items.value = ['x', 'y']
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(parent.textContent).toBe('xy')
  })

  it('keeps rows when primitive values are unchanged', async () => {
    setRenderer(createDOMRenderer())
    const log: string[] = []
    const parent = document.createElement('div')
    const items = state(['a', 'b'])
    insertList(parent, null, () => items.value, item => loggedRow(item, log))
    const runsAfterMount = log.filter(entry => entry.startsWith('run:')).length

    items.value = ['a', 'b']
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(parent.textContent).toBe('ab')
    expect(log.filter(entry => entry.startsWith('cleanup:'))).toHaveLength(0)
    expect(log.filter(entry => entry.startsWith('run:'))).toHaveLength(runsAfterMount)
  })

  it('disposes replaced primitive rows and keeps untouched rows', async () => {
    setRenderer(createDOMRenderer())
    const log: string[] = []
    const parent = document.createElement('div')
    const items = state(['a', 'b'])
    insertList(parent, null, () => items.value, item => loggedRow(item, log))

    items.value = ['c', 'b']
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(parent.textContent).toBe('cb')
    expect(log).toContain('cleanup:a')
    expect(log).toContain('run:c')
    expect(log).not.toContain('cleanup:b')
  })

  it('still updates object rows in place through reactive proxies', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const users = state([
      { id: 1, name: 'a' },
      { id: 2, name: 'b' }
    ])
    insertList(
      parent,
      null,
      () => users.value,
      user => {
        const span = document.createElement('span')
        const text = document.createTextNode('')
        span.append(text)
        // 模拟编译产物：{user.name} 经代理转发 item.value，在行内 effect 中被追踪
        insertDynamicValue(span, null, () => user.name)
        return span
      },
      user => user.id
    )
    expect(parent.textContent).toBe('ab')

    users.value = [
      { id: 1, name: 'a2' },
      { id: 2, name: 'b2' }
    ]
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(parent.textContent).toBe('a2b2')
  })
})

describe('keyed list minimal-move reconciliation', () => {
  interface Row { id: number; name: string }

  function setup(initial: Row[]) {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const source = state(initial)
    const rows = new Map<number, Element>()
    insertList(
      parent,
      null,
      () => source.value,
      item => {
        const el = document.createElement('li')
        el.textContent = item.name
        rows.set(item.id, el)
        return el
      },
      row => row.id
    )
    const order = () =>
      Array.from(parent.children)
        .filter(node => node.tagName === 'LI')
        .map(node => node.textContent)
    return { parent, source, rows, order }
  }

  // name → 稳定 id 映射：重排 name 顺序 = 真正的 key 重排
  // （若用数组下标当 id，重排后 key 顺序不变，keyed reconcile 正确地零移动）
  const ids = new Map<string, number>()
  const rows = (names: string[]): Row[] => names.map(name => {
    if (!ids.has(name)) ids.set(name, ids.size)
    return { id: ids.get(name)!, name }
  })

  it('swaps two adjacent rows and preserves row node identity', async () => {
    const { parent, source, rows: rowMap, order } = setup(rows(['a', 'b', 'c']))
    const nodeB = rowMap.get(1)
    const nodeC = rowMap.get(2)

    source.value = rows(['a', 'c', 'b'])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['a', 'c', 'b'])
    // 最小移动：行节点复用，不整行重建；保留行不被移除
    expect(rowMap.get(1)).toBe(nodeB)
    expect(rowMap.get(2)).toBe(nodeC)
    expect(parent.contains(nodeB!)).toBe(true)
  })

  it('moves the first row to the end', async () => {
    const { source, order } = setup(rows(['a', 'b', 'c', 'd']))

    source.value = rows(['b', 'c', 'd', 'a'])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['b', 'c', 'd', 'a'])
  })

  it('reverses the whole list', async () => {
    const { source, order } = setup(rows(['a', 'b', 'c', 'd', 'e']))

    source.value = rows(['e', 'd', 'c', 'b', 'a'])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('keeps DOM untouched when order is unchanged but item objects are new', async () => {
    const { source, rows: rowMap, order } = setup(rows(['a', 'b', 'c']))
    const nodesBefore = [rowMap.get(0), rowMap.get(1), rowMap.get(2)]

    // 全新对象、相同 key、相同顺序：应当零移动零重建
    source.value = [{ id: 0, name: 'a' }, { id: 1, name: 'b' }, { id: 2, name: 'c' }]
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['a', 'b', 'c'])
    expect([rowMap.get(0), rowMap.get(1), rowMap.get(2)]).toEqual(nodesBefore)
  })

  it('handles mixed remove + insert + move in one update', async () => {
    const { source, order } = setup(rows(['a', 'b', 'c', 'd', 'e']))

    // 移除 b、新增 f、d 前移，同时 a 挪到末尾
    source.value = [
      { id: 2, name: 'c' },
      { id: 3, name: 'd' },
      { id: 5, name: 'f' },
      { id: 4, name: 'e' },
      { id: 0, name: 'a' }
    ]
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['c', 'd', 'f', 'e', 'a'])
  })

  it('keeps the list anchored after surrounding sibling content', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const head = document.createElement('p')
    head.textContent = 'head'
    parent.appendChild(head)
    const source = state(rows(['a', 'b', 'c']))
    insertList(
      parent,
      null,
      () => source.value,
      item => {
        const el = document.createElement('li')
        el.textContent = item.name
        return el
      },
      row => row.id
    )
    const tail = document.createElement('p')
    tail.textContent = 'tail'
    parent.appendChild(tail)

    source.value = rows(['c', 'a', 'b'])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(parent.textContent).toBe('headcabtail')
  })

  it('rebuilds index-tracked rows when they move', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const source = state(rows(['a', 'b', 'c']))
    insertList(
      parent,
      null,
      () => source.value,
      (item, index) => {
        const el = document.createElement('li')
        el.textContent = `${item.name}:${index}`
        return el
      },
      row => row.id
    )
    expect(parent.textContent).toBe('a:0b:1c:2')

    source.value = rows(['c', 'a', 'b'])
    await new Promise(resolve => setTimeout(resolve, 0))
    // index 参与渲染的行移动时必须重建，索引值正确
    expect(parent.textContent).toBe('c:0a:1b:2')
  })

  it('falls back to indexed reconcile when keys are missing', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    // 原始类型项：keyOf 对 'b' 返回 null → 回退 indexed 调和
    const source = state(['a', 'b', 'c'])
    insertList(
      parent,
      null,
      () => source.value,
      item => {
        const el = document.createElement('li')
        el.textContent = item
        return el
      },
      (item, index) => (item === 'b' ? null : index)
    )
    expect(parent.textContent).toBe('abc')

    source.value = ['x', 'y', 'z']
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(parent.textContent).toBe('xyz')
  })
})

