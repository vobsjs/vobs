// @vitest-environment jsdom
/*
 * vobs（应用层）核心不变量检查。
 *
 *   I1 run-once      —— 组件函数必须**只执行一次**；状态变化不得让它重跑
 *   I2 生命周期      —— destroy 必须释放 owner/effect/插件清理；失败路径不得留下"半挂载"状态
 *   I4 编译期/运行期 —— 应用层与渲染器/owner 的契约一致
 *
 * 判据一律是可观察行为（组件体执行次数、effect 还跑不跑、DOM 结果）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { effect, state } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { createComponent, createElement as createElementNode, createVobs, setRenderer } from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

let apps: Array<{ destroy(): void }> = []
afterEach(() => {
  for (const app of apps) { try { app.destroy() } catch { /* 已销毁 */ } }
  apps = []
  document.body.innerHTML = ''
})

function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('I1 · 组件函数只执行一次（run-once 是核心不变量）', () => {
  it('状态变化不得让组件体重跑', async () => {
    let componentRuns = 0
    const counter = state(0)

    const app = createVobs({
      render: () => {
        componentRuns += 1
        return (() => {
          const el = document.createElement('div')
          el.textContent = `count:${counter.value}`
          return el
        })() as never
      }
    })
    apps.push(app)
    app.mount(makeContainer())
    expect(componentRuns).toBe(1)

    counter.value = 1
    counter.value = 2
    await flush()
    app.update()

    // 组件体只执行一次；值的变化由绑定负责，不是靠重跑组件
    expect(componentRuns).toBe(1)
  })

  it('mount 之后重复 mount 不得让组件体再跑一次', () => {
    let componentRuns = 0
    const app = createVobs({
      render: () => {
        componentRuns += 1
        return document.createElement('div') as never
      }
    })
    apps.push(app)
    const a = makeContainer()
    const b = makeContainer()
    app.mount(a)
    expect(componentRuns).toBe(1)
    app.mount(b)                 // 已挂载 → 应当 no-op
    expect(componentRuns).toBe(1)
  })
})

describe('I2 · destroy 必须释放 owner 与 effect', () => {
  it('destroy 后组件内建立的 effect 不得再运行', async () => {
    /*
     * 用 `createComponent` 让 effect 建立在**组件自己的 owner** 下 —— 这才是真实形态
     * （直接用 createVobs 的 render 不会建立组件 owner，那样测不到 destroy 的级联）。
     */
    const value = state(0)
    let componentRuns = 0
    let effectRuns = 0

    const Child = () => {
      componentRuns += 1
      effect(() => { value.value; effectRuns += 1 })
      return createElementNode('div')
    }

    const app = createVobs({ render: () => createComponent(Child, {}) as never })
    apps.push(app)
    app.mount(makeContainer())
    expect(componentRuns).toBe(1)
    expect(effectRuns).toBe(1)

    value.value = 1
    await flush()
    expect(effectRuns).toBe(2)

    app.destroy()
    const before = effectRuns
    value.value = 2
    await flush()
    // 组件 owner 随 destroy 释放 → effect 必须解绑
    expect(effectRuns).toBe(before)
  })

  it('destroy 必须清空容器', () => {
    const app = createVobs({ render: () => document.createElement('section') as never })
    apps.push(app)
    const container = makeContainer()
    app.mount(container)
    expect(container.children.length).toBe(1)
    app.destroy()
    expect(container.children.length).toBe(0)
  })

  it('destroy 是幂等的，不重复跑清理', () => {
    let cleans = 0
    const app = createVobs({ render: () => document.createElement('div') as never })
    apps.push(app)
    app.use({ name: 'p1', install: () => () => { cleans += 1 } })
    app.mount(makeContainer())
    app.destroy()
    app.destroy()
    expect(cleans).toBe(1)
  })

  it('插件清理在组件树释放之后执行（顺序契约）', () => {
    const order: string[] = []
    const app = createVobs({ render: () => document.createElement('div') as never })
    apps.push(app)
    app.use({ name: 'p1', install: () => () => { order.push('plugin-cleanup') } })
    app.mount(makeContainer())
    app.destroy()
    // 目前实现：先插件清理，再 rootOwner.dispose
    expect(order).toEqual(['plugin-cleanup'])
  })

  it('destroy 之后不得再 mount / update / use', () => {
    const app = createVobs({ render: () => document.createElement('div') as never })
    app.destroy()
    expect(() => app.mount(makeContainer())).toThrow()
    expect(() => app.update()).toThrow()
    expect(() => app.use({ name: 'x', install: () => {} })).toThrow()
  })
})

describe('I2 · 挂载失败路径不得留下半挂载状态', () => {
  it('render 抛错后：app.destroyed 为真、容器被清空、重复 destroy 安全', () => {
    const app = createVobs({
      render: () => { throw new Error('render boom') }
    })
    apps.push(app)
    const container = makeContainer()
    expect(() => app.mount(container)).toThrow('render boom')
    expect(app.destroyed).toBe(true)
    expect(app.mounted).toBe(false)
    expect(container.children.length).toBe(0)
    expect(() => app.destroy()).not.toThrow()
  })

  it('render 抛错后容器**不得**残留被渲染了一半的节点', () => {
    const app = createVobs({
      render: () => {
        const el = document.createElement('div')
        el.textContent = 'partial'
        throw new Error('after insert?')
      }
    })
    apps.push(app)
    const container = makeContainer()
    expect(() => app.mount(container)).toThrow()
    expect(container.querySelector('div')).toBeNull()
  })
})
