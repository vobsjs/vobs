// @vitest-environment jsdom
/*
 * `<select value={…}>` 插入 option 时的值重放，**不得建立隐藏订阅**。
 *
 * 机制：`bindProperty(select,'value',…)` 会注册一个 reader（`ops.ts` 的
 * `selectValueReaders`），插入 `<option>` 时同步重放当前值。
 * 而插入往往发生在某个 effect 运行期间（`insertList`/`insertDynamic` 都由 effect 驱动）——
 * 若重放里的读取被算进**外层 effect 的依赖**，该 effect 以后会被那个信号唤醒：
 * 依赖图上多一条没人打算建立的边（"隐藏订阅"），表现为"插选项时某个不相关的 effect 重跑了"。
 *
 * 判据用**行为**：外层 effect 的重跑次数。
 * 修复前：插入 option 时外层 effect 会额外重跑（因为它意外订阅了值信号）。
 * 修复后：外层 effect 只被它自己读的信号驱动。
 */
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { effect, scheduler } from '@vobs/reactivity'
import { bindProperty, createElement, insertBefore, setAttribute } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

function optionFor(value: string): HTMLOptionElement {
  const option = createElement('option') as HTMLOptionElement
  setAttribute(option, 'value', value)
  return option
}

describe('<select> value 重放不得建立隐藏订阅', () => {
  it('插入 option 不会让"值信号"之外的 effect 被唤醒', () => {
    const select = createElement('select')
    const selectedValue = state('b')
    const unrelated = state(0)

    bindProperty(select, 'value', () => selectedValue.value)

    // 外层 effect：只读 `unrelated`，与 select 的值无关
    let runs = 0
    const stop = effect(() => {
      runs += 1
      void unrelated.value
      // 在 effect 内插入选项 —— 模拟列表驱动的动态 option
      const option = optionFor('a')
      insertBefore(select, option, null)
    })
    settle()
    const afterFirst = runs
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    // 改**值信号**：外层 effect 没读过它，不该被唤醒
    selectedValue.value = 'a'
    settle()
    expect(runs, '插入 option 的路径让外层 effect 意外订阅了 select 的值信号').toBe(afterFirst)

    stop.dispose()
  })

  it('重放仍然生效：动态插入的 option 能命中已绑定的值', () => {
    const select = createElement('select')
    const selectedValue = state('b')
    bindProperty(select, 'value', () => selectedValue.value)
    settle()

    insertBefore(select, optionFor('a'), null)
    insertBefore(select, optionFor('b'), null)
    settle()

    // 值 'b' 对应的 option 现在存在了 → select.value 应当命中
    expect(select.value).toBe('b')
  })

  it('值信号变化本身仍然驱动 select.value（绑定没被 untrack 弄坏）', () => {
    const select = createElement('select')
    const selectedValue = state('a')
    bindProperty(select, 'value', () => selectedValue.value)
    insertBefore(select, optionFor('a'), null)
    insertBefore(select, optionFor('b'), null)
    settle()
    expect(select.value).toBe('a')

    selectedValue.value = 'b'
    settle()
    expect(select.value, '绑定的 effect 没跟上值信号').toBe('b')
  })

  it('optgroup 内的 option 也会触发重放（既有语义不变）', () => {
    const select = createElement('select')
    const selectedValue = state('x')
    bindProperty(select, 'value', () => selectedValue.value)
    const group = createElement('optgroup')
    insertBefore(select, group, null)
    insertBefore(group, optionFor('x'), null)
    settle()
    expect(select.value).toBe('x')
  })

  it('没有绑定值的 select 插入 option 是安全的（reader 不存在）', () => {
    const select = createElement('select')
    expect(() => {
      insertBefore(select, optionFor('a'), null)
    }).not.toThrow()
    expect(select.value).toBe('a')
  })
})
