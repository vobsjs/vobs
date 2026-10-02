// @vitest-environment jsdom
/*
 * `onMount` —— 客户端生命周期原语。
 *
 * 为什么需要它（外部踩坑文档 D 条 + 能力覆盖度分析「生命周期零记录」）：
 * 定时器、`matchMedia`、`localStorage`、量元素尺寸这些只能在客户端做的事，
 * 此前**没有正式位置** —— 业务只能手写 `typeof window !== 'undefined'`，
 * 或在组件体里直接调用（于是预渲染阶段就炸或泄漏）。
 *
 * 语义与 run-once 一致：**挂载同步过程结束后跑一次**，不是每次渲染都跑。
 */
import { describe, expect, it, vi } from 'vitest'
import { createOwner, onDispose } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { onDestroy, onMount } from './index'

setRenderer(createDOMRenderer())

/** 等微任务（onMount 用微任务延后到挂载之后）。 */
const flushMicrotasks = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

describe('onMount', () => {
  it('组件挂载后执行一次，且此时 DOM 已在文档中', async () => {
    let mountedAtCall: boolean | null = null
    let runs = 0
    const Comp = (): VobsNode => {
      const el = createElement('div')
      onMount(() => {
        runs += 1
        // 关键：回调里能读到"已挂载进文档"，所以可以量尺寸 / focus / matchMedia
        mountedAtCall = el.isConnected
      })
      return el
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)

    await flushMicrotasks()
    expect(runs).toBe(1)
    expect(mountedAtCall, 'onMount 执行时节点还没挂进文档').toBe(true)

    await flushMicrotasks()
    expect(runs, 'onMount 不该重复执行').toBe(1)
    app.destroy()
    host.remove()
  })

  it('组件在微任务之前就被卸载 → 回调不执行（防泄漏）', async () => {
    const spy = vi.fn()
    const Comp = (): VobsNode => {
      onMount(spy)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    app.destroy()                  // 立刻卸载，微任务还没跑

    await flushMicrotasks()
    expect(spy, '已卸载组件的 onMount 仍执行了（会泄漏定时器/监听）').not.toHaveBeenCalled()
    host.remove()
  })

  it('不在 Owner 下调用 → 立刻执行，不静默丢弃', () => {
    const spy = vi.fn()
    onMount(spy)
    expect(spy, '没有 Owner 时 onMount 被静默丢弃').toHaveBeenCalledTimes(1)
  })

  it('返回的撤销函数能在执行前取消', async () => {
    const spy = vi.fn()
    const Comp = (): VobsNode => {
      const cancel = onMount(spy)
      cancel()
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    await flushMicrotasks()
    expect(spy).not.toHaveBeenCalled()
    app.destroy()
    host.remove()
  })

  it('普通 Owner（effect 作用域）里也能用', async () => {
    const spy = vi.fn()
    const owner = createOwner()
    owner.run(() => { onMount(spy) })
    expect(spy).not.toHaveBeenCalled()      // 还没到微任务
    await flushMicrotasks()
    expect(spy).toHaveBeenCalledTimes(1)
    owner.dispose()
  })

  it('传非函数 → 抛出（不静默）', () => {
    expect(() => onMount(undefined as never)).toThrowError(/函数/u)
  })

  it('没有 document 时不执行（Node 端预渲染）', async () => {
    const spy = vi.fn()
    const originalDocument = globalThis.document
    // 模拟 Node 端：摘掉 document
    // @ts-expect-error 故意删除以模拟无 DOM 环境
    delete globalThis.document
    try {
      const owner = createOwner()
      owner.run(() => { onMount(spy) })
      await flushMicrotasks()
      expect(spy, '预渲染阶段执行了客户端回调').not.toHaveBeenCalled()
      owner.dispose()
    } finally {
      globalThis.document = originalDocument
    }
  })
})

describe('onDestroy —— 与 onMount 配成一套', () => {
  it('卸载时执行', async () => {
    const cleaned = vi.fn()
    const Comp = (): VobsNode => {
      onDestroy(cleaned)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    expect(cleaned).not.toHaveBeenCalled()
    app.destroy()
    expect(cleaned, '卸载时 onDestroy 没有执行').toHaveBeenCalledTimes(1)
    host.remove()
  })

  it('与 onMount 配对：挂载后起定时器、卸载时清掉（D 条那个 hero 轮播形态）', async () => {
    const timer = { id: 0 }
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    try {
      const Comp = (): VobsNode => {
        onMount(() => { timer.id = setInterval(() => { /* tick */ }, 5000) as unknown as number })
        onDestroy(() => { clearInterval(timer.id) })
        return createElement('div')
      }
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createComponent(Comp, {}) })
      app.mount(host)
      // onMount 是微任务：必须等它跑完才能断言定时器已起
      await flushMicrotasks()

      expect(setSpy, 'onMount 里没有起定时器').toHaveBeenCalled()
      expect(clearSpy, '挂载阶段就清了（时序不对）').not.toHaveBeenCalled()

      app.destroy()
      expect(clearSpy, 'onDestroy 没有清掉定时器（会泄漏）').toHaveBeenCalledWith(timer.id)
      host.remove()
    } finally {
      setSpy.mockRestore(); clearSpy.mockRestore()
    }
  })

  it('不在 Owner 下调用 → 抛出（不静默丢弃，那会变成最难查的泄漏）', () => {
    expect(() => onDestroy(() => undefined)).toThrowError(/组件/u)
  })

  it('传非函数 → 抛出', () => {
    const owner = createOwner()
    owner.run(() => {
      expect(() => onDestroy(undefined as never)).toThrowError(/函数/u)
    })
    owner.dispose()
  })

  it('单个清理抛错不中断其余清理（与 onDispose 同一隔离）', () => {
    const order: string[] = []
    const owner = createOwner()
    owner.run(() => {
      onDestroy(() => { order.push('first') })
      onDestroy(() => { order.push('throw'); throw new Error('boom') })
      onDestroy(() => { order.push('last') })
    })
    // owner.dispose 会把第一个错误抛出来（owner.ts 的既有语义），但其余清理都跑过
    expect(() => owner.dispose()).toThrowError('boom')
    expect(order, '一个清理抛错把后面的清理弄丢了').toEqual(['last', 'throw', 'first'])
  })

  it('与 onDispose 行为一致（同一个操作，两个名字）', async () => {
    const viaDestroy = vi.fn()
    const viaDispose = vi.fn()
    const Comp = (): VobsNode => {
      onDestroy(viaDestroy)
      onDispose(viaDispose)
      return createElement('div')
    }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createComponent(Comp, {}) })
    app.mount(host)
    app.destroy()
    expect(viaDestroy).toHaveBeenCalledTimes(1)
    expect(viaDispose).toHaveBeenCalledTimes(1)
    host.remove()
  })
})
