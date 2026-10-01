// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Alert, Switch } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 组件的 `role` 兜底。
 *
 * `role` 本来就走 `bindCommonAttributes` 的通用通道（utils.ts:219 的 isCommonAttribute 里有它）。
 * 但 Alert 和 Switch 把 `role` 放进了那张表的 skip 列表，然后**无条件硬编码**：
 *
 *     bindCommonAttributes(root, props, ['tone', 'title', 'description', 'icon', 'role'])
 *     setAttribute(root, 'role', 'alert')          // ← 作者传的 role 被静默吞掉
 *
 * 实测：`<Alert role="status">` 拿到的是 `role="alert"`。现在作者给了就用作者的，没给才兜底。
 */
async function mount(component: Parameters<typeof createComponent>[0], props: Record<string, unknown>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props) })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('role 兜底（不再吞掉作者传入的 role）', () => {
  it('Alert 尊重作者传入的 role', async () => {
    const { host, cleanup } = await mount(Alert, { role: 'status', title: 'hi' })
    expect(host.querySelector('.vui-alert')?.getAttribute('role')).toBe('status')
    cleanup()
  })

  it('Alert 没给 role 时退回 alert', async () => {
    const { host, cleanup } = await mount(Alert, { title: 'hi' })
    expect(host.querySelector('.vui-alert')?.getAttribute('role')).toBe('alert')
    cleanup()
  })

  it('Switch 尊重作者传入的 role', async () => {
    const { host, cleanup } = await mount(Switch, { role: 'checkbox' })
    expect(host.querySelector('.vui-switch')?.getAttribute('role')).toBe('checkbox')
    cleanup()
  })

  it('Switch 没给 role 时退回 switch', async () => {
    const { host, cleanup } = await mount(Switch, {})
    expect(host.querySelector('.vui-switch')?.getAttribute('role')).toBe('switch')
    cleanup()
  })
})
