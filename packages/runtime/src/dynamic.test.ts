// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, createText, insertDynamicValue, insertList, insertDynamic, addEventListener, createComponent, type DynamicChild } from '@vobs/vobs'
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
      // Tag per instance: after an array swap the new component's effect legitimately runs too; don't share the counter
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
    // The old component's effect must be cleaned up, not left subscribing to signals and writing to detached DOM
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
    // Ghost effects must not fire again
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
  // Simulate compiled output: {item} compiles to insertDynamicValue(() => item);
  // the primitive is statically captured and doesn't subscribe to the item signal.
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
    // Primitive items can't refresh their view via the item signal; the row must be rebuilt
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
        // Simulate compiled output: {user.name} is forwarded through the proxy to item.value, tracked inside the row effect
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

  // name → stable id mapping: reordering the names = a real key reorder
  // (using array indices as ids would leave the key order unchanged after reorder,
  // and keyed reconcile would correctly do zero moves)
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
    // Minimal moves: row nodes reused, no whole-row rebuilds; kept rows are not removed
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

    // Brand-new objects, same keys, same order: should be zero moves and zero rebuilds
    source.value = [{ id: 0, name: 'a' }, { id: 1, name: 'b' }, { id: 2, name: 'c' }]
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(order()).toEqual(['a', 'b', 'c'])
    expect([rowMap.get(0), rowMap.get(1), rowMap.get(2)]).toEqual(nodesBefore)
  })

  it('handles mixed remove + insert + move in one update', async () => {
    const { source, order } = setup(rows(['a', 'b', 'c', 'd', 'e']))

    // Remove b, add f, move d forward, and move a to the end
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
    // Rows whose index participates in rendering must be rebuilt when they move; index values correct
    expect(parent.textContent).toBe('c:0a:1b:2')
  })

  it('falls back to indexed reconcile when keys are missing', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    // Primitive items: keyOf returns null for 'b' → fall back to indexed reconcile
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


describe('component render isolation (untrack)', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('signal reads in the component body do not become insertDynamic structural dependencies', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(false)
    const unrelated = state(0)
    let builds = 0
    function Panel(): Node {
      builds += 1
      // The component body reads a signal: before the fix this was tracked as an ancestor
      // effect dependency and triggered a whole-tree rebuild
      unrelated.value
      return document.createElement('input')
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Panel, {}) : null))
    expect(builds).toBe(0)

    visible.value = true
    await flush()
    expect(builds).toBe(1)
    expect(parent.querySelector('input')).not.toBeNull()

    unrelated.value = 99
    await flush()
    // An unrelated signal change must not rebuild the subtree
    expect(builds).toBe(1)

    visible.value = false
    await flush()
    // The conditional factory's own dependencies still work
    expect(parent.querySelector('input')).toBeNull()
    expect(builds).toBe(1)
  })

  it('event listeners of dynamic components stay functional after signal changes', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(true)
    const content = state('')
    function Field(): Node {
      const input = document.createElement('input')
      addEventListener(input, 'input', event => {
        content.set((event.target as HTMLInputElement).value)
      })
      return input
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Field, {}) : null))
    await flush()

    const input = parent.querySelector('input')!
    input.value = 'hello'
    input.dispatchEvent(new Event('input'))
    expect(content.value).toBe('hello')

    // After triggering a change of a signal read during rendering, the event listener still works
    visible.value = true
    await flush()
    input.value = 'world'
    input.dispatchEvent(new Event('input'))
    expect(content.value).toBe('world')
  })
})

describe('polymorphic insertDynamicValue (Solid-style runtime polymorphism)', () => {
  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  it('string updates rewrite the text node in place (node identity preserved, bindText-level performance)', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const label = state('hello')
    insertDynamicValue(parent, null, () => label.value)
    const textNode = parent.firstChild
    expect(textNode?.nodeType).toBe(3)
    expect(parent.textContent).toBe('hello')

    label.value = 'world'
    await flush()
    // Fast path: the same text node is reused, only the content changes
    expect(parent.firstChild).toBe(textNode)
    expect(parent.textContent).toBe('world')
  })

  it('numeric children hit the text fast path too', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const count = state(0)
    insertDynamicValue(parent, null, () => count.value)
    const textNode = parent.firstChild
    expect(parent.textContent).toBe('0')

    count.value = 42
    await flush()
    expect(parent.firstChild).toBe(textNode)
    expect(parent.textContent).toBe('42')
  })

  // Regression (Labelune postmortem): a function call in JSX child position returning a
  // Fragment used to be String()'d into "[object Object]"; with polymorphic insertion the
  // node value mounts correctly and can switch back and forth with primitives.
  it('function call returning a Fragment mounts correctly and switches with strings', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const mode = state<'doc' | 'plain'>('doc')
    const renderDoc = (): VobsNode => {
      const section = document.createElement('p')
      section.textContent = 'clause body'
      return createFragment((fragmentParent, anchor) => {
        fragmentParent.insertBefore(section, anchor)
      })
    }
    insertDynamicValue(parent, null, () => (mode.value === 'doc' ? renderDoc() : 'plain text'))
    expect(parent.textContent).toBe('clause body')

    mode.value = 'plain'
    await flush()
    expect(parent.textContent).toBe('plain text')

    mode.value = 'doc'
    await flush()
    expect(parent.textContent).toBe('clause body')
  })

  it('node value changes replace wholesale, old subtree effects cleaned up', async () => {
    setRenderer(createDOMRenderer())
    const log: string[] = []
    const version = state(0)
    function Panel(): Node {
      effect(() => {
        log.push(`run:v${version.value}`)
        return () => log.push('cleanup')
      })
      const el = document.createElement('p')
      el.textContent = `v${version.value}`
      return el
    }
    const parent = document.createElement('div')
    // The factory reads version to establish the structural dependency: version change →
    // factory re-runs → new component replaces the old subtree
    // (the component body is untracked, its own render establishes no dependency —
    // matching the compiled output's insertDynamicValue semantics)
    insertDynamicValue(parent, null, () => {
      void version.value
      return createComponent(Panel, {})
    })
    expect(parent.textContent).toBe('v0')

    version.value = 1
    await flush()
    expect(parent.textContent).toBe('v1')
    expect(log).toContain('cleanup')
    expect(log).toContain('run:v1')
  })

  it('null/undefined/boolean clear text and node subtrees', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const value = state<DynamicChild>('text')
    insertDynamicValue(parent, null, () => value.value)
    expect(parent.textContent).toBe('text')
    const textNode = parent.firstChild

    value.value = null
    await flush()
    expect(parent.textContent).toBe('')

    value.value = false
    await flush()
    expect(parent.textContent).toBe('')

    const el = document.createElement('span')
    value.value = el
    await flush()
    expect(parent.contains(el)).toBe(true)

    value.value = false
    await flush()
    expect(parent.contains(el)).toBe(false)
    // Text node identity persists across string rounds (the earlier textNode was cleared with null)
    expect(parent.contains(textNode as Node)).toBe(false)
  })
})
