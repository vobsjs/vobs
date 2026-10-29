// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Alert, StatusBar, Switch } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * `role` fallback for components.
 *
 * `role` normally goes through the generic channel of `bindCommonAttributes` (it is in
 * isCommonAttribute at utils.ts:219). But Alert and Switch put `role` into that table's skip
 * list and then **hard-coded it unconditionally**:
 *
 *     bindCommonAttributes(root, props, ['tone', 'title', 'description', 'icon', 'role'])
 *     setAttribute(root, 'role', 'alert')          // ← the author-supplied role was silently swallowed
 *
 * Verified: `<Alert role="status">` came out as `role="alert"`. Now the author's value wins when
 * given; the fallback applies only when absent.
 */
async function mount(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('role fallback (no longer swallows the author-supplied role)', () => {
  it('Alert respects an author-supplied role', async () => {
    const { host, cleanup } = await mount(Alert, { role: 'status', title: 'hi' })
    expect(host.querySelector('.vui-alert')?.getAttribute('role')).toBe('status')
    cleanup()
  })

  it('Alert falls back to alert when no role is given', async () => {
    const { host, cleanup } = await mount(Alert, { title: 'hi' })
    expect(host.querySelector('.vui-alert')?.getAttribute('role')).toBe('alert')
    cleanup()
  })

  it('Switch respects an author-supplied role', async () => {
    const { host, cleanup } = await mount(Switch, { role: 'checkbox' })
    expect(host.querySelector('.vui-switch')?.getAttribute('role')).toBe('checkbox')
    cleanup()
  })

  it('Switch falls back to switch when no role is given', async () => {
    const { host, cleanup } = await mount(Switch, {})
    expect(host.querySelector('.vui-switch')?.getAttribute('role')).toBe('switch')
    cleanup()
  })

  it('StatusBar respects an author-supplied role', async () => {
    const { host, cleanup } = await mount(StatusBar, { role: 'toolbar' })
    expect(host.querySelector('.vui-statusbar')?.getAttribute('role')).toBe('toolbar')
    cleanup()
  })

  it('StatusBar falls back to status when no role is given', async () => {
    const { host, cleanup } = await mount(StatusBar, {})
    expect(host.querySelector('.vui-statusbar')?.getAttribute('role')).toBe('status')
    cleanup()
  })
})