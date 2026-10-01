// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs } from '@vobs/vobs'
import { DevToolsWidget } from './widget'

/*
 * devtools-ui 此前**一个测试都没有**（106KB 的 panel 加上 widget 全是裸奔）。
 * 这里只做冒烟：能挂载、入口按钮在、点得开。真正的断言交给 panel 自身，但至少
 * 让「改坏了 import / 组件体里读信号 / 挂载即抛」这类问题在 CI 里立刻现形。
 */
describe('DevToolsWidget 冒烟', () => {
  it('挂载后出现入口按钮', () => {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsWidget({ label: '打开调试台' })
    })
    app.mount(host)

    expect(host.querySelector('.vobs-devtools-widget')).toBeTruthy()
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('打开调试台')

    app.destroy()
    expect(host.childNodes.length).toBe(0)
  })

  it('点击入口按钮会打开对话框', async () => {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsWidget({ label: '打开调试台' })
    })
    app.mount(host)

    const button = host.querySelector('button')
    button?.dispatchEvent(new host.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }))
    // 动态分支是微任务批处理，放开一轮再断言
    await Promise.resolve()
    await Promise.resolve()

    expect(host.textContent ?? '').toContain('Runtime DevTools')

    app.destroy()
  })
})
