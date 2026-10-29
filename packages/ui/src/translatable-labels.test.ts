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
 * Translatable aria-labels.
 *
 * The English constant labels in ui fall into two groups: some are already **fallbacks**
 * (`if (!hasProp(props, 'aria-label'))`, overridable by the author — the activity-rail /
 * file-tree / pagination roots are like this, fine); the other group was **unconditionally
 * hard-coded**, and since the generic attribute channel runs first and the hard-code runs after,
 * the author's value got overwritten:
 *
 *     bindCommonAttributes(root, props, [...])            // writes the author's aria-label first
 *     setAttribute(root, 'aria-label', 'Notifications')   // ← immediately overwrites it
 *
 * The combobox toggle button went further and hard-coded the literal 'toggle' — which wasn't even
 * meaningful English (it's a "show options" button).
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

describe('translatable aria-labels', () => {
  it('ToastHost defaults to Notifications and does not override an author-supplied label', async () => {
    const fallback = await mount(ToastHost, {}, toastPlugins())
    expect(fallback.host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('Notifications')
    fallback.cleanup()

    const custom = await mount(ToastHost, { 'aria-label': '通知中心' }, toastPlugins())
    expect(custom.host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('通知中心')
    custom.cleanup()
  })

  it('the Combobox toggle button defaults to text describing the action (was the literal toggle)', async () => {
    const { host, cleanup } = await mount(Combobox, { options: [{ label: 'a', value: 'a' }] })
    expect(host.querySelector('.vui-combobox__toggle')?.getAttribute('aria-label')).toBe('Show options')
    cleanup()
  })

  it('the Combobox toggle button label can be passed in (translatable)', async () => {
    const { host, cleanup } = await mount(Combobox, {
      options: [{ label: 'a', value: 'a' }],
      toggleLabel: '展开选项'
    })
    expect(host.querySelector('.vui-combobox__toggle')?.getAttribute('aria-label')).toBe('展开选项')
    cleanup()
  })

  it('the Pagination page label defaults to Page N and accepts a function to localize', async () => {
    const byText = (host: HTMLElement, text: string): HTMLElement | undefined =>
      [...host.querySelectorAll<HTMLElement>('button')].find(button => button.textContent === text)

    const plain = await mount(Pagination, { page: 2, pageCount: 5 })
    expect(byText(plain.host, '2')?.getAttribute('aria-label')).toBe('Page 2')
    plain.cleanup()

    const localized = await mount(Pagination, { page: 2, pageCount: 5, pageLabel: (page: number) => `第 ${page} 页` })
    expect(byText(localized.host, '2')?.getAttribute('aria-label')).toBe('第 2 页')
    localized.cleanup()
  })

  it('the EditorTabs close button label includes the title by default and accepts a function to localize', async () => {
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

  it('the three WorkbenchTitlebar window button labels can be localized', async () => {
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

  it('the MessageHost container label and role can be passed in (it reads props directly, with no generic attribute channel)', async () => {
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