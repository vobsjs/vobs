import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, setRenderer } from '@vobs/vobs'
import { hydrate, renderToString } from './index'

/**
 * `setRenderer` 是**进程级单例**（runtime/src/ops.ts:20）。应用 mount 时装上自己的渲染器，
 * 但原来**销毁时不还原** —— 一次 `renderToString`（内部 mount → destroy）之后，全局渲染器就
 * 永久停在 SSR 渲染器上：同进程后续任何 `createElement` 都返回纯数据对象（没有 tagName），
 * 对真实 DOM 节点做属性操作也会抛错；`renderToStringAsync` 的 await 窗口里两个请求还会互相串。
 *
 * 水合失败同理：`hydration.ts` 只在**成功**路径 `completeHydration()` 里把 `hydrating` 置回
 * false，失败后全局渲染器又停在"正在认领 DOM"的那一份上，级联抛错。
 */
describe('SSR 渲染器不污染进程', () => {
  it('renderToString 之后全局渲染器还原（createElement 仍产出真实 DOM）', () => {
    setRenderer(createDOMRenderer())
    const html = renderToString(() => createElement('div'))
    expect(html).toBe('<div></div>')

    const node = createElement('span')
    expect(node).toBeInstanceOf(Element)
    expect((node as unknown as { tagName: string }).tagName).toBe('SPAN')
  })

  it('水合失败之后全局渲染器也要还原', () => {
    setRenderer(createDOMRenderer())
    document.body.innerHTML = renderToString(() => createElement('h1'))

    expect(() => hydrate(() => createElement('p'), document.body)).toThrow('hydration')

    const node = createElement('span')
    expect(node).toBeInstanceOf(Element)
    document.body.innerHTML = ''
  })
})
