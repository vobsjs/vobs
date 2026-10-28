// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, insertShow, insertList } from '@vobs/vobs'
import { effect, state } from '@vobs/reactivity'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * insertShow —— 编译器「三元/&& 分支里的 keyed 列表」专用产物（C232 根治）。
 * 契约：cond 只管容器挂载/卸载；列表在容器内走标准 insertList（keyed 复用）；
 * 卸载 = dispose 容器 scope（行内 effect 一并清理，无幽灵更新）。
 */
describe('insertShow', () => {
  it('条件为真挂载容器并渲染列表行；为假整体卸载', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state(['a', 'b'])
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, item => {
        const el = document.createElement('span')
        el.dataset.item = item
        el.textContent = item
        return el
      })
    })
    expect(parent.querySelectorAll('span')).toHaveLength(2)
    expect(parent.textContent).toBe('ab')

    visible.value = false
    await tick()
    expect(parent.querySelectorAll('span')).toHaveLength(0)

    visible.value = true
    await tick()
    expect(parent.querySelectorAll('span')).toHaveLength(2)
    expect(parent.textContent).toBe('ab')
  })

  it('条件不变、列表变化时 keyed 复用 —— 复用行不重新渲染，只有新行走 renderItem', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state([{ id: 'a' }, { id: 'b' }])
    let renderCount = 0
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, item => {
        renderCount++
        const el = document.createElement('span')
        el.dataset.id = item.id
        return el
      }, item => item.id)
    })
    expect(renderCount).toBe(2)

    // cond 抖动（false → true）：容器重建，整列重挂
    visible.value = false
    await tick()
    renderCount = 0
    visible.value = true
    await tick()
    expect(renderCount).toBe(2)

    // cond 保持 true，只换列表数据：keyed 复用 —— a 行不重渲染，仅 c 行新建
    renderCount = 0
    items.value = [{ id: 'a' }, { id: 'c' }]
    await tick()
    expect(renderCount).toBe(1)
    expect(parent.querySelector('[data-id="a"]')).not.toBeNull()
    expect(parent.querySelector('[data-id="b"]')).toBeNull()
    expect(parent.querySelector('[data-id="c"]')).not.toBeNull()
  })

  it('卸载后行内 effect 被清理，不再响应信号（无幽灵更新）', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state(['a'])
    const counter = state(0)
    const runs: number[] = []
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, () => {
        const el = document.createElement('span')
        effect(() => {
          counter.value
          runs.push(counter.value)
          return () => { runs.push(-1) }
        })
        return el
      })
    })
    expect(runs).toEqual([0])

    visible.value = false
    await tick()
    expect(runs).toEqual([0, -1])

    counter.value = 1
    await tick()
    // 幽灵 effect 不允许再触发
    expect(runs).toEqual([0, -1])
  })

  it('条件高频抖动不产生重复容器', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    let mountCount = 0
    insertShow(
      parent,
      null,
      () => visible.value,
      () => { mountCount++ }
    )
    for (let i = 0; i < 5; i++) {
      visible.value = !visible.value
    }
    await tick()
    // 信号同值写入不触发 effect，末次可见值取决于奇偶抖动后的最终写入；
    // 断言核心：mount 只在「 false → true 的沿」发生，不会重复挂载
    expect(mountCount).toBeLessThanOrEqual(3)
    expect(mountCount).toBeGreaterThanOrEqual(1)
    visible.value = true
    await tick()
    // 从 false → true 再挂一次；若已挂载则不重复
    const after = mountCount
    visible.value = true
    await tick()
    expect(mountCount).toBe(after)
  })
})
