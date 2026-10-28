// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs } from '@vobs/vobs'
import { DevToolsWidget } from './widget'

/*
 * devtools-ui previously had **no tests at all** (the 106KB panel plus widget ran bare).
 * This is smoke-only: it mounts, the launcher button is present, and it opens. Real assertions
 * belong to the panel itself, but at least problems like "breaking imports / reading signals in
 * the component body / throwing on mount" now surface immediately in CI.
 */
describe('DevToolsWidget smoke', () => {
  it('shows the launcher button after mounting', () => {
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

  it('clicking the launcher button opens the dialog', async () => {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsWidget({ label: '打开调试台' })
    })
    app.mount(host)

    const button = host.querySelector('button')
    button?.dispatchEvent(new host.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true }))
    // the dynamic branch is microtask-batched; let a round run before asserting
    await Promise.resolve()
    await Promise.resolve()

    expect(host.textContent ?? '').toContain('Runtime DevTools')

    app.destroy()
  })
})
