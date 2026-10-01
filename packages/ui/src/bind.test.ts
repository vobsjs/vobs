// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Checkbox, Input, Textarea } from './index'

/*
 * bind 双向绑定。
 *
 * 这里曾经**完全没有测试** —— 全仓库唯一的 bind 测试落在 Combobox（而它不走表单控件
 * 这条路径）。于是这个 bug 一直藏着：`listen` 每次调用都新建包装函数，而 runtime 的
 * `addEventListener` 每个 (node, event) 只有一个槽，后注册的（用户 handler）把先注册的
 * （bind 写回）顶掉 —— 输入后信号永远不变、而且零报错。
 *
 * 所以这组测试同时锁两件事：**写回生效** 和 **用户 handler 仍然被调用**。
 */
const flush = () => { scheduler.flush(); scheduler.flush() }

function mountControl(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const host = document.createElement('div')
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  flush()
  return { host, app }
}

describe('bind 写回', () => {
  it('Input：输入写回信号，且用户 onInput 照旧触发', () => {
    const value = state('初始')
    const seen: string[] = []
    const { host, app } = mountControl(Input, {
      bind: value,
      onInput: (event: Event) => seen.push((event.target as HTMLInputElement).value)
    })
    const input = host.querySelector('input') as HTMLInputElement
    input.value = 'typed'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    flush()

    expect(value.value).toBe('typed')
    expect(seen).toEqual(['typed'])
    app.destroy()
  })

  it('Textarea：输入写回信号', () => {
    const value = state('初始')
    const { host, app } = mountControl(Textarea, { bind: value })
    const el = host.querySelector('textarea') as HTMLTextAreaElement
    el.value = 'typed'
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
    flush()

    expect(value.value).toBe('typed')
    app.destroy()
  })

  it('Checkbox：勾选写回布尔信号', () => {
    const checked = state(false)
    const { host, app } = mountControl(Checkbox, { bind: checked })
    const el = host.querySelector('input[type=checkbox]') as HTMLInputElement
    el.checked = true
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    flush()

    expect(checked.value).toBe(true)
    app.destroy()
  })

  it('信号 → DOM：bind 的信号变化会写回控件（反向也要通）', () => {
    const value = state('a')
    const { host, app } = mountControl(Input, { bind: value })
    const input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('a')

    value.value = 'b'
    flush()
    expect(input.value).toBe('b')
    app.destroy()
  })
})
