// @vitest-environment jsdom
/*
 * Icon lookup misses must **not be silent** (external postmortem doc item H:
 * lucide icon whitelist silently rendered blank).
 *
 * Mechanism: when the app-side "name → icon definition" lookup misses it
 * returns empty, renders an empty `<span>`, no error — so when a new page used
 * an unregistered icon, the UI just showed "nothing there" and someone had to
 * spot it by eye. The doc records three hit variants already (keyboard /
 * upload-cloud / triangle-alert, plus the `ICONS` / `FAVORITES` dual-list confusion).
 *
 * The framework can't fix the app's whitelist (the lookup lives on the app
 * side), but it can **speak up about the miss** — that's the behavior this
 * file locks in.
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createSvgIconNode, type SvgIconDefinition } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('missing icon observability', () => {
  it('undefined definition + name provided → warns and reports the name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({
        render: () => createSvgIconNode(undefined as never, {} as never, { dataIconName: 'keyboard' } as never)
      })
      app.mount(host)
      settle()

      expect(host.querySelector('span')?.innerHTML).toBe('')   // still empty (render semantics unchanged)
      const calls = warn.mock.calls.map(call => String(call[0])).join('\n')
      expect(calls, 'missing icon produced no message at all (the silent blank from doc item H)').toContain('keyboard')
      expect(calls).toContain('has no definition')
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('still emits a generic warning without a name (never silent)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createSvgIconNode(undefined as never) })
      app.mount(host)
      settle()
      expect(warn.mock.calls.length, 'completely silent').toBeGreaterThan(0)
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('warns only once per missing name (effect re-runs don\'t spam)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (let i = 0; i < 3; i++) {
        const host = document.createElement('main')
        document.body.appendChild(host)
        const app = createVobs({
          render: () => createSvgIconNode(undefined as never, {} as never, { dataIconName: 'upload-cloud' } as never)
        })
        app.mount(host)
        settle()
        app.destroy(); host.remove()
      }
      const aboutUpload = warn.mock.calls
        .map(call => String(call[0]))
        .filter(text => text.includes('upload-cloud'))
      expect(aboutUpload, 'the same missing name was warned repeatedly').toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('does **not** warn when a definition exists (normal path unaffected)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const pen: SvgIconDefinition = { name: 'pen', body: '<path d="M4 4 L20 20" />' }
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createSvgIconNode(pen) })
      app.mount(host)
      settle()
      expect(host.querySelector('svg'), 'the normal icon did not render').not.toBeNull()
      expect(warn, `normal path emitted warnings: ${warn.mock.calls.map(c => String(c[0])).join(' | ')}`).not.toHaveBeenCalled()
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('with a definition, data-icon-name is still attached (existing behavior unchanged)', () => {
    const pen: SvgIconDefinition = { name: 'pen', body: '<path d="M4 4 L20 20" />' }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createSvgIconNode(pen) })
    app.mount(host)
    settle()
    expect(host.querySelector('[data-icon-name="pen"]')).not.toBeNull()
    app.destroy(); host.remove()
  })
})
