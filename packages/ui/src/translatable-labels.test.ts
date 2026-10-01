// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, type VobsPlugin } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { createNotification, notificationPlugin } from '@vobs/notification'
import { Combobox, ToastHost } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 可翻译的 aria-label。
 *
 * ui 里的英文常量标签分两类：一部分本来就是**兜底**（`if (!hasProp(props, 'aria-label'))`，
 * 作者能覆盖 —— activity-rail / file-tree / pagination 根节点就是这种，没问题）；
 * 另一部分是**无条件写死**，而通用属性通道先跑、它后跑，于是作者传的会被盖掉：
 *
 *     bindCommonAttributes(root, props, [...])            // 先把作者的 aria-label 写上
 *     setAttribute(root, 'aria-label', 'Notifications')   // ← 立刻盖掉
 *
 * combobox 的开关按钮更直接写死成字面量 'toggle' —— 连英文语义都不成立（它是"展开选项"的按钮）。
 */
async function mount(
  component: Parameters<typeof createComponent>[0],
  props: Record<string, unknown>,
  plugins: VobsPlugin[] = []
) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(component, props), plugins })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

const toastPlugins = (): VobsPlugin[] => {
  const notification = createNotification({ defaultDuration: 0 })
  return [notificationPlugin({ notification })]
}

describe('可翻译的 aria-label', () => {
  it('ToastHost 默认是 Notifications，作者传入时不覆盖', async () => {
    const fallback = await mount(ToastHost, {}, toastPlugins())
    expect(fallback.host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('Notifications')
    fallback.cleanup()

    const custom = await mount(ToastHost, { 'aria-label': '通知中心' }, toastPlugins())
    expect(custom.host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('通知中心')
    custom.cleanup()
  })

  it('Combobox 开关按钮默认是描述动作的文案（原来是字面量 toggle）', async () => {
    const { host, cleanup } = await mount(Combobox, { options: [{ label: 'a', value: 'a' }] })
    expect(host.querySelector('.vui-combobox__toggle')?.getAttribute('aria-label')).toBe('Show options')
    cleanup()
  })

  it('Combobox 开关按钮的标签可以传入（可翻译）', async () => {
    const { host, cleanup } = await mount(Combobox, {
      options: [{ label: 'a', value: 'a' }],
      toggleLabel: '展开选项'
    })
    expect(host.querySelector('.vui-combobox__toggle')?.getAttribute('aria-label')).toBe('展开选项')
    cleanup()
  })
})
