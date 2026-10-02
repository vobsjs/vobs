// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { bindText, createElement, createText, insertBefore, insertList, type VobsNode } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/**
 * `insertList` 的 renderItem 拿到的是"响应式条目代理"：属性读取转发到 item 信号，
 * 所以行内 effect 能读到同 key 顶替后的新条目。
 *
 * 这个代理原来的目标是**创建时的原始条目**。只要条目被 Object.freeze 过
 * （@vobs/notification 每条通知都冻结），目标上就留着"不可配置、不可写"的自有属性，
 * get 陷阱返回新值时违反 Proxy 不变量，实测直接抛：
 *
 *   TypeError: 'get' on proxy: property 'label' is a read-only and non-configurable data
 *   property on the proxy target but the proxy did not return its actual value
 *
 * 于是冻结条目的行根本无法原地刷新。首轮渲染时 item.value === 目标，值相同，看不出来。
 */
describe('insertList 的响应式条目代理', () => {
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
      // 在 effect 内读条目：顶替后必须拿到新值
      bindText(text, () => String((item as { label?: unknown }).label ?? item))
      node = li
      return li
    }, keyOf)
    return { host, captured, getNode: () => node }
  }

  it('冻结条目顶替后行内 effect 读到新值，且行被原地复用', async () => {
    const rows = state<readonly { id: number; label: string }[]>([Object.freeze({ id: 1, label: 'a' })])
    const { host, getNode, captured } = mount(rows, (item: { id: number }) => item.id)
    await flush()
    expect(host.textContent).toBe('a')
    const first = getNode()

    rows.value = [Object.freeze({ id: 1, label: 'b' })]
    await flush()

    expect(host.textContent).toBe('b')          // 修复前这一行直接抛 TypeError
    expect(getNode()).toBe(first)               // keyed 调和：同一个 DOM 行
    // 冻结条目的描述符不变量：Object.keys / 展开 / in 也不能抛
    const item = captured[captured.length - 1] as { id: number; label: string }
    expect(Object.keys(item)).toEqual(['id', 'label'])
    expect({ ...item }).toEqual({ id: 1, label: 'b' })
    expect('label' in item).toBe(true)
  })

  it('未冻结条目与数组条目保持原有语义（原型 / Array.isArray / 长度）', async () => {
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
