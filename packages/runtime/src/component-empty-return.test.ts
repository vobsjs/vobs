// @vitest-environment jsdom
/*
 * 组件返回 `null` / `undefined` / `false` **不得让 App 崩溃**。
 *
 * 这是生产事故的根因（Labelune 2026-09-30 发版黑屏）：
 * `createComponent` 把渲染结果直接当作 `nodeOwners` 这个 **WeakMap 的 key**，
 * 而 `null` / `undefined` 不是合法 key → 抛 `Invalid value used as weak map key`。
 * 最贵的地方是**诊断信息**：App 挂载即崩、没有任何 JS 崩溃日志、splash 兜底也失效。
 *
 * 「组件顶层条件 return null」（`cond ? <X/> : null`、`cond && <X/>`）是合法 JSX 写法。
 * 修法：归一化成**空注释节点** —— 视觉为空（与返回 null 一致），但满足 `VobsNode` 契约，
 * 于是挂载 / HMR 刷新 / 节点替换 / 水合都不需要各自特判"空"分支。
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { insertDynamic } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

function mount(render: () => VobsNode) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ render })
  app.mount(host)
  return { host, app, cleanup: () => { app.destroy(); host.remove() } }
}

describe('组件返回空值不再崩溃', () => {
  it('顶层 return null → 不抛、渲染为空', () => {
    const Cond = (props: { on: boolean }): VobsNode =>
      (props.on ? createText('yes') : null) as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Cond, { on: false })) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('返回 undefined → 不抛、渲染为空', () => {
    const Blank = (): VobsNode => undefined as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Blank, {})) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('返回 false（`cond && <X/>` 形态）→ 不抛、渲染为空', () => {
    const Maybe = (props: { on: boolean }): VobsNode =>
      (props.on && createText('yes')) as unknown as VobsNode
    let view: ReturnType<typeof mount> | undefined
    expect(() => { view = mount(() => createComponent(Maybe, { on: false })) }).not.toThrow()
    expect(view!.host.textContent).toBe('')
    view!.cleanup()
  })

  it('cond 为真时正常渲染（没有把功能一起打死）', () => {
    const Cond = (props: { on: boolean }): VobsNode =>
      (props.on ? createText('yes') : null) as unknown as VobsNode
    const view = mount(() => createComponent(Cond, { on: true }))
    expect(view.host.textContent).toBe('yes')
    view.cleanup()
  })

  it('返回 null 的组件**嵌在树中间**时，兄弟节点照常渲染', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => {
      const wrap = document.createElement('div')
      wrap.append(document.createTextNode('before'))
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.append(document.createTextNode('after'))
      return wrap as unknown as VobsNode
    })
    expect(view.host.textContent).toBe('beforeafter')
    view.cleanup()
  })

  it('条件工厂在 null ↔ 节点之间切换（响应式）', () => {
    const on = state(false)
    /*
     * 注意这里用的是 `createBlock`（条件工厂）而不是 `createComponent(..., { on: on.value })`。
     * 后者是**违反 run-once 契约**的写法：组件体与渲染只执行一次，
     * 在外层 render 里读信号不会订阅、也不会重跑（正是文档里 B 条那条纪律）。
     * 结构性变化必须由条件工厂或绑定 effect 承担 —— 响应式来自 `insertDynamic`
     * 驱动的工厂，`createBlock` 只是"每次都重新建"的工厂本身。
     */
    const view = mount(() => {
      const wrap = document.createElement('div')
      insertDynamic(wrap as unknown as Node, null, () => (on.value ? createText('shown') : null))
      return wrap as unknown as VobsNode
    })

    expect(view.host.textContent).toBe('')
    on.value = true
    settle()
    expect(view.host.textContent, '切到节点后没有渲染出来').toBe('shown')
    on.value = false
    settle()
    expect(view.host.textContent, '切回 null 后没有清空').toBe('')
    view.cleanup()
  })

  it('返回 null 的组件销毁时不抛错（Owner 正常释放）', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => createComponent(Blank, {}))
    expect(() => view.app.destroy()).not.toThrow()
    view.host.remove()
  })

  it('连续多个返回 null 的组件并存', () => {
    const Blank = (): VobsNode => null as unknown as VobsNode
    const view = mount(() => {
      const wrap = document.createElement('div')
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      wrap.appendChild(createComponent(Blank, {}) as unknown as Node)
      return wrap as unknown as VobsNode
    })
    expect(view.host.textContent).toBe('')
    expect(() => view.cleanup()).not.toThrow()
  })
})
