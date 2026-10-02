// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, createText, setRenderer } from '@vobs/vobs'
import { mount } from './index'

/*
 * test-utils 的 `mount()` 会把测试渲染器装进**进程级** `setRenderer` 单例。
 * 原来它不注册任何清理：只要有一条用例忘记 `destroy()`，同文件**后续所有** DOM 用例的
 * `createElement` 就会返回普通对象 `{type,tag,attrs,…}` 而不是 DOM 节点 ——
 * 而 vitest 按文件隔离，"单跑该文件"完全看不见（典型的"单独绿、全量红"）。
 *
 * 关键：这里**不能**用 beforeEach 重装 DOM 渲染器（那会掩盖污染），
 * 只在模块作用域装一次，让清理逻辑成为两次用例之间唯一会还原因素。
 */
setRenderer(createDOMRenderer())

describe('test-utils mount 的自动清理', () => {
  it('第一条故意不 destroy()', () => {
    const view = mount(() => createText('leaked'))
    expect(view.container).toBeDefined()
    // 故意不调用 view.destroy()
  })

  it('上一条没 destroy，这一条的全局渲染器也必须已经复原', () => {
    expect(createElement('div')).toBeInstanceOf(Element)
  })
})
