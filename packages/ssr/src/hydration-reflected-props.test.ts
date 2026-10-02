// @vitest-environment jsdom
/*
 * 水合往返：`id` / `style` / `title` 经 SSR 序列化后，客户端水合必须**保留**它们，
 * 且水合后的响应式仍然工作。
 *
 * 为什么专门测这三个：本轮改过 SSR 的属性输出（`18435dc` 让它们走属性通道）。
 * 那次改动会让产物里**多出**属性，而水合有严格的校验 —— 如果客户端不认领这些属性，
 * strictHydration 就会把它们当差异报出来。所以这条既补上"水合路径"的覆盖，
 * 也是对上一次改动的回归验证。
 *
 * ⚠️ 断言前必须等调度器排空：信号写入经 `queueMicrotask` 异步派发
 * （`reactivity/src/scheduler.ts`）。**同步读 DOM 会看到旧值** ——
 * 我第一版就是这么写的，于是误判成"水合后响应式失效"。
 * 用 `scheduler.flush()` 是最稳的（不依赖 microtask 次数）。
 */
import { describe, expect, it } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { bindText, createElement, createText, insertBefore, setProperty } from '@vobs/dom'
import { hydrate, renderToString } from './index'

const settle = (): void => { scheduler.flush() }

describe('水合往返：总是反射的属性', () => {
  const render = () => {
    const div = createElement('div')
    setProperty(div, 'id', 'hero')
    setProperty(div, 'style', 'color:red')
    setProperty(div, 'title', '提示')
    const text = createText('')
    insertBefore(div, text, null)
    bindText(text, () => 'body')
    return div
  }

  it('SSR 产物里带着这三个属性', () => {
    const html = renderToString(render)
    expect(html).toContain('id="hero"')
    expect(html).toContain('title="提示"')
    expect(html).toMatch(/style="[^"]*color:\s*red/)
  })

  it('水合之后属性仍在（不会被清掉或覆盖）', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)

    const div = document.body.querySelector('div')!
    expect(div.getAttribute('id')).toBe('hero')
    expect(div.getAttribute('title')).toBe('提示')
    expect(div.getAttribute('style')).toMatch(/color:\s*red/)
    expect(div.textContent).toBe('body')

    app.destroy()
    document.body.innerHTML = ''
  })

  it('水合复用服务端节点（节点身份保持），而不是重建', () => {
    document.body.innerHTML = renderToString(render)
    const before = document.body.querySelector('div')
    const app = hydrate(render, document.body)
    expect(document.body.querySelector('div')).toBe(before)
    app.destroy()
    document.body.innerHTML = ''
  })

  it('strictHydration 不因这些属性误报', () => {
    /*
     * 注意：`bindText` 的水合本来就是"服务端非空 → 客户端空文本节点"的形态
     * （`createText('')` + effect 覆写），strictHydration 对**动态文本**会报 content。
     * 那是有意的语义（见 strict-hydration.test.ts）。所以这里用**静态**内容，
     * 专测属性维度是否有差异。
     */
    const staticRender = () => {
      const div = createElement('div')
      setProperty(div, 'id', 'hero')
      setProperty(div, 'style', 'color:red')
      setProperty(div, 'title', '提示')
      insertBefore(div, createText('static'), null)
      return div
    }
    document.body.innerHTML = renderToString(staticRender)
    let error: unknown
    let app: { destroy(): void } | undefined
    try {
      app = hydrate(staticRender, document.body, { strictHydration: true })
    } catch (reason) {
      error = reason
    }
    expect(
      error,
      `strictHydration 报出了差异: ${JSON.stringify((error as { vobsHydration?: unknown })?.vobsHydration)}`
    ).toBeUndefined()
    app?.destroy()
    document.body.innerHTML = ''
  })

  it('水合之后响应式仍然工作（绑定 effect 随信号更新）', () => {
    const value = state('first')
    const view = () => {
      const div = createElement('div')
      setProperty(div, 'id', 'live')
      const text = createText('')
      insertBefore(div, text, null)
      bindText(text, () => value.value)
      return div
    }
    document.body.innerHTML = renderToString(view)
    expect(document.body.textContent).toBe('first')

    const app = hydrate(view, document.body)
    expect(document.body.textContent).toBe('first')

    value.value = 'second'
    // 修复/验证要点：必须让调度器排空后再断言
    settle()
    expect(document.body.textContent, '水合后绑定没有随信号更新').toBe('second')

    value.value = 'third'
    settle()
    expect(document.body.textContent).toBe('third')

    app.destroy()
    document.body.innerHTML = ''
  })
})
