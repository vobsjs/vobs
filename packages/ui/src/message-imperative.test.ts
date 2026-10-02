// @vitest-environment jsdom
/*
 * 组件外可用的命令式 `message` API（外部踩坑文档 P 条）。
 *
 * 原来只有组件形态的 `MessageHost`，而它通过 `inject` 取上下文 —— **只能在组件体内取到**。
 * 业务方被迫自建 `stores/toast.ts` 全局桥（App 挂载时 `bindToast` 一次），
 * 文档里说这类手搓替代品"本身就是后续踩坑温床"。
 *
 * 判据：`message.success(...)` 能在**没有任何组件上下文**的地方调用（模块顶层/普通函数），
 * 消息真的进入界面上那个 Host；Host 卸载后调用会**抛出并说明原因**而不是静默丢弃。
 */
import { describe, expect, it } from 'vitest'
import { createNotification } from '@vobs/notification'
import { scheduler } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { message, MessageHost } from './index'

setRenderer(createDOMRenderer())
// 消息进信号是同步的，但 DOM 渲染经调度器异步派发 —— 断言文字前必须 flush
const flush = (): void => { scheduler.flush() }

function mountHost() {
  const context = createNotification()
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    render: () => createComponent(MessageHost, { message: context } as never)
  })
  app.mount(host)
  return {
    context,
    host,
    cleanup: () => { app.destroy(); host.remove(); context.dispose() }
  }
}

describe('message 命令式 API（组件外可用）', () => {
  it('组件外调用 message.success → 消息进入 Host', () => {
    const view = mountHost()
    // 这里是纯模块作用域，没有任何 inject 上下文
    const id = message.success('已保存')
    expect(typeof id).toBe('string')
    expect(view.context.notifications.value).toHaveLength(1)
    expect(view.context.notifications.value[0]!.content).toBe('已保存')
    flush()
    expect(view.host.textContent).toContain('已保存')
    view.cleanup()
  })

  it('四种类型都能用', () => {
    const view = mountHost()
    message.info('i')
    message.success('s')
    message.warning('w')
    message.error('e')
    expect(view.context.notifications.value.map(item => item.type)).toEqual(['info', 'success', 'warning', 'error'])
    view.cleanup()
  })

  it('dismiss / clear 也能在组件外调用', () => {
    const view = mountHost()
    const id = message.info('a')
    message.info('b')
    expect(view.context.notifications.value).toHaveLength(2)
    expect(message.dismiss(id)).toBe(true)
    expect(view.context.notifications.value).toHaveLength(1)
    message.clear()
    expect(view.context.notifications.value).toHaveLength(0)
    view.cleanup()
  })

  it('Host 卸载后调用 → 抛出并说明原因（不静默丢弃）', () => {
    const view = mountHost()
    message.info('before')
    view.cleanup()                     // Host 卸载 → 解绑
    expect(message.bound).toBe(false)
    expect(() => message.success('after')).toThrowError(/MessageHost/u)
  })

  it('从未挂载 Host 时调用 → 同样抛出', () => {
    // 这个文件里前面的用例已 cleanup，此处应处于未绑定状态
    expect(message.bound).toBe(false)
    expect(() => message.info('nope')).toThrowError(/MessageHost/u)
  })

  it('重新挂载后可以继续用', () => {
    const view = mountHost()
    expect(message.bound).toBe(true)
    message.success('again')
    expect(view.context.notifications.value).toHaveLength(1)
    view.cleanup()
  })

  it('后挂载的 Host 接管绑定（先卸载的那个不会把桥清掉）', () => {
    const first = mountHost()
    const second = mountHost()
    expect(message.bound).toBe(true)
    // 卸载第一个：桥应仍指向第二个
    first.cleanup()
    expect(message.bound, '先卸载的 Host 把桥清掉了').toBe(true)
    message.info('goes-to-second')
    expect(second.context.notifications.value).toHaveLength(1)
    second.cleanup()
    expect(message.bound).toBe(false)
  })

  it('辅助函数返回节点时也不影响（组件外调用与渲染无关）', () => {
    const view = mountHost()
    const notifyFromHelper = (): string => message.warning('helper')
    expect(notifyFromHelper()).toBeTruthy()
    flush()
    expect(view.host.textContent).toContain('helper')
    view.cleanup()
  })

  it('类型声明齐全（返回 id 为字符串）', () => {
    const view = mountHost()
    const id: string = message.error('x')
    expect(id.startsWith('')).toBe(true)
    view.cleanup()
  })

  it('MessageHost 仍是合法节点（组件形态没被破坏）', () => {
    const view = mountHost()
    expect(view.host.querySelector('.vui-message-host')).not.toBeNull()
    view.cleanup()
  })
})

// 保持类型引用不被打成未使用
void (null as unknown as VobsNode)
