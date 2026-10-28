// @vitest-environment jsdom
/*
 * `<ClientOnly>` — a subtree rendered only on the client (the second half of external
 * postmortem doc item D).
 *
 * The only thing that needs careful thought here is the **two-phase** design: the naive
 * implementation (server renders nothing, client renders children) causes a **hydration
 * mismatch**. So both sides render fallback in the first pass, and children are swapped
 * in only after mount.
 *
 * This file's core criterion is that **hydration matches** (`strictHydration` reports no
 * difference), and that the content really appears after the swap.
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
      // ClientOnly returns a fragment, which must be mounted via insertBefore (it handles fragments)
      insertBefore(wrap, child, null)
      return wrap as unknown as VobsNode
    }
  })
  app.mount(host)
  return { host, app, cleanup: () => { app.destroy(); host.remove() } }
}

describe('ClientOnly', () => {
  it('swaps in children after mount', async () => {
    const view = mountClientOnly()
    flush()
    // First pass: not yet
    expect(view.host.textContent).toBe('')
    await microtasks()
    flush()
    expect(view.host.textContent, 'children were not swapped in after mount').toBe('CLIENT')
    view.cleanup()
  })

  it('server rendering does not produce children (the SSG phase never touches browser APIs)', () => {
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
    expect(html, 'client-only content appeared in the SSR output').not.toContain('CLIENT')
  })

  it('**hydration matches** (strictHydration reports no difference) — the reason for the two-phase design', async () => {
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
    // The server output contains the fallback
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
      `hydration reported a difference: ${JSON.stringify((error as { vobsHydration?: unknown })?.vobsHydration)}`
    ).toBeUndefined()

    // The hydration first pass still shows the fallback (matching the output); children come after
    expect(document.body.textContent).toBe('placeholder')
    await microtasks()
    flush()
    expect(document.body.textContent, 'children were not swapped in after hydration').toBe('CLIENT')

    app?.destroy()
    document.body.innerHTML = ''
  })

  it('fallback renders in the first pass (server and client agree)', () => {
    const view = mountClientOnly({ fallback: () => createText('loading') })
    flush()
    expect(view.host.textContent).toBe('loading')
    view.cleanup()
  })

  it('component unmounted before the microtask → no flip, no throw', async () => {
    const view = mountClientOnly()
    view.cleanup()
    await microtasks()
    flush()
    expect(view.host.textContent).toBe('')
    expect(view.host.isConnected).toBe(false)
  })

  it('no residue after unmount (fragment nodes cleared)', async () => {
    const view = mountClientOnly()
    await microtasks()
    flush()
    expect(view.host.textContent).toBe('CLIENT')
    view.cleanup()
    expect(view.host.innerHTML).toBe('')
  })
})
