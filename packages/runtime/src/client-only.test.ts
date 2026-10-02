// @vitest-environment jsdom
/*
 * `<ClientOnly>` —— 只在客户端渲染的子树（外部踩坑文档 D 条的后一半）。
 *
 * 这个组件唯一需要想清楚的地方是**两阶段**：朴素实现（服务端渲染空、客户端渲染 children）
 * 会造成**水合不匹配**。所以首轮两侧都渲染 fallback，挂载后才换入 children。
 *
 * 本文件的核心判据就是**水合能对上**（`strictHydration` 不报差异），
 * 以及换入之后内容真的出现了。
 */
import { describe, expect, it } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createText, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { renderToString, hydrate } from '@vobs/ssr'
import { ClientOnly, insertBefore } from './index'

setRenderer(createDOMRenderer())
const flush = (): void => { scheduler.flush() }
const microtasks = async (): Promise<void> => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
}

function mountClientOnly(extra: Record<string, unknown> = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    render: () => {
      const wrap = createElement('div')
      const child = createComponent(ClientOnly, {
        children: () => {
          const widget = createElement('span')
          widget.textContent = 'CLIENT'
          return widget
        },
        ...extra
      } as never)
      // ClientOnly 返回的是 fragment，必须由 insertBefore 挂载（它会处理 fragment）
      insertBefore(wrap, child, null)
      return wrap as unknown as VobsNode
    }
  })
  app.mount(host)
  return { host, app, cleanup: () => { app.destroy(); host.remove() } }
}

describe('ClientOnly', () => {
  it('挂载后换入 children', async () => {
    const view = mountClientOnly()
    flush()
    // 首轮：还没有
    expect(view.host.textContent).toBe('')
    await microtasks()
    flush()
    expect(view.host.textContent, '挂载后没有换入 children').toBe('CLIENT')
    view.cleanup()
  })

  it('服务端渲染不产出 children（SSG 阶段不会碰浏览器 API）', () => {
    const tree = () => {
      const wrap = createElement('div')
      const child = createComponent(ClientOnly, {
        children: () => {
          const el = createElement('span')
          el.textContent = 'CLIENT'
          return el
        }
      } as never)
      insertBefore(wrap, child, null)
      return wrap as unknown as VobsNode
    }
    const html = renderToString(tree)
    expect(html, 'SSR 产物里出现了只在客户端才该有的内容').not.toContain('CLIENT')
  })

  it('**水合对得上**（strictHydration 不报差异）—— 这是两阶段设计的理由', async () => {
    const tree = () => {
      const wrap = createElement('div')
      const child = createComponent(ClientOnly, {
        children: () => {
          const el = createElement('span')
          el.textContent = 'CLIENT'
          return el
        },
        fallback: () => createText('placeholder')
      } as never)
      insertBefore(wrap, child, null)
      return wrap as unknown as VobsNode
    }
    document.body.innerHTML = renderToString(tree)
    // 服务端产物里是 fallback
    expect(document.body.textContent).toBe('placeholder')

    let error: unknown
    let app: { destroy(): void } | undefined
    try {
      app = hydrate(tree, document.body, { strictHydration: true })
    } catch (reason) {
      error = reason
    }
    expect(
      error,
      `水合报出了差异：${JSON.stringify((error as { vobsHydration?: unknown })?.vobsHydration)}`
    ).toBeUndefined()

    // 水合首轮仍是 fallback（与产物一致），之后才换成 children
    expect(document.body.textContent).toBe('placeholder')
    await microtasks()
    flush()
    expect(document.body.textContent, '水合后没有换入 children').toBe('CLIENT')

    app?.destroy()
    document.body.innerHTML = ''
  })

  it('fallback 在首轮渲染（服务端与客户端一致）', () => {
    const view = mountClientOnly({ fallback: () => createText('loading') })
    flush()
    expect(view.host.textContent).toBe('loading')
    view.cleanup()
  })

  it('组件在微任务之前被卸载 → 不翻转、不抛错', async () => {
    const view = mountClientOnly()
    view.cleanup()
    await microtasks()
    flush()
    expect(view.host.textContent).toBe('')
    expect(view.host.isConnected).toBe(false)
  })

  it('卸载后没有残留（fragment 节点被清掉）', async () => {
    const view = mountClientOnly()
    await microtasks()
    flush()
    expect(view.host.textContent).toBe('CLIENT')
    view.cleanup()
    expect(view.host.innerHTML).toBe('')
  })
})
