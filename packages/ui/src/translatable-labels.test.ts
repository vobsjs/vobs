// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, type VobsPlugin } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { createNotification, messagePlugin, notificationPlugin } from '@vobs/notification'
import { Combobox, EditorTabs, MessageHost, Pagination, ToastHost, WorkbenchTitlebar } from './index'

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

  it('Pagination 页码标签默认 Page N，可传入函数本地化', async () => {
    const byText = (host: HTMLElement, text: string): HTMLElement | undefined =>
      [...host.querySelectorAll<HTMLElement>('button')].find(button => button.textContent === text)

    const plain = await mount(Pagination, { page: 2, pageCount: 5 })
    expect(byText(plain.host, '2')?.getAttribute('aria-label')).toBe('Page 2')
    plain.cleanup()

    const localized = await mount(Pagination, { page: 2, pageCount: 5, pageLabel: (page: number) => `第 ${page} 页` })
    expect(byText(localized.host, '2')?.getAttribute('aria-label')).toBe('第 2 页')
    localized.cleanup()
  })

  it('EditorTabs 关闭按钮标签默认带标题，可传入函数本地化', async () => {
    const byLabel = (host: HTMLElement, label: string): HTMLElement | undefined =>
      [...host.querySelectorAll<HTMLElement>('button')].find(button => button.getAttribute('aria-label') === label)

    const plain = await mount(EditorTabs, { tabs: [{ id: 'a', label: 'A.ts', closeable: true }] })
    expect(byLabel(plain.host, 'Close A.ts')).toBeTruthy()
    plain.cleanup()

    const localized = await mount(EditorTabs, {
      tabs: [{ id: 'a', label: 'A.ts', closeable: true }],
      closeLabel: (tabLabel: string) => `关闭 ${tabLabel}`
    })
    expect(byLabel(localized.host, '关闭 A.ts')).toBeTruthy()
    localized.cleanup()
  })

  it('WorkbenchTitlebar 三个窗口按钮的标签可本地化', async () => {
    const byAriaLabel = (host: HTMLElement, label: string): HTMLElement | undefined =>
      [...host.querySelectorAll<HTMLElement>('[aria-label]')].find(el => el.getAttribute('aria-label') === label)

    const plain = await mount(WorkbenchTitlebar, {})
    expect(byAriaLabel(plain.host, 'Close window')).toBeTruthy()
    expect(byAriaLabel(plain.host, 'Minimize window')).toBeTruthy()
    expect(byAriaLabel(plain.host, 'Maximize window')).toBeTruthy()
    plain.cleanup()

    const localized = await mount(WorkbenchTitlebar, {
      windowControlLabel: (kind: string) => `窗口-${kind}`
    })
    expect(byAriaLabel(localized.host, '窗口-close')).toBeTruthy()
    expect(byAriaLabel(localized.host, '窗口-min')).toBeTruthy()
    localized.cleanup()
  })

  it('MessageHost 的容器标签与 role 可传入（它直接读 props，没有通用属性通道）', async () => {
    const fallback = await mount(MessageHost, {}, [messagePlugin({ defaultDuration: 0 })])
    const root = fallback.host.querySelector('.vui-message-host')
    expect(root?.getAttribute('aria-label')).toBe('Messages')
    expect(root?.getAttribute('role')).toBe('region')
    fallback.cleanup()

    const custom = await mount(MessageHost, { 'aria-label': '消息列表', role: 'log' }, [messagePlugin({ defaultDuration: 0 })])
    const customRoot = custom.host.querySelector('.vui-message-host')
    expect(customRoot?.getAttribute('aria-label')).toBe('消息列表')
    expect(customRoot?.getAttribute('role')).toBe('log')
    custom.cleanup()
  })
})