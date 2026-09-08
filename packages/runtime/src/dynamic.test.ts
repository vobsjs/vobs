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

