// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Tabs, type TabItem } from './index'

setRenderer(createDOMRenderer())

/*
 * Tabs 的无障碍：面板角色 + 键盘操作。
 *
 * 原来只有 `role="tablist"`/`role="tab"` + 鼠标点击：
 *   - 面板**完全没有 role**（只有 tab 有），屏幕阅读器读不出"这是标签页的内容区"
 *   - 键盘用户按 Tab 会依次停靠**每一个**标签（没有 roving tabindex），方向键毫无反应
 *   - 而 `role="tab"` 的存在意味着屏幕阅读器按"方向键可切换"来播报，两边对不上
 *
 * 聚焦要等更新落地（选中会触发标签条重渲染），所以断言前要让出微任务。
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const ITEMS: TabItem[] = ['a', 'b', 'c'].map(id => ({
  id,
  label: id.toUpperCase(),
  content: () => createText(`panel ${id}`)
}))

async function mountTabs(changes: string[] = []) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(Tabs, { items: ITEMS, onChange: (id: string) => changes.push(id) })
  })
  app.mount(host)
  await settle()
  const buttons = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
  const selectedIndex = (): number => buttons().findIndex(b => b.getAttribute('aria-selected') === 'true')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, app, buttons, selectedIndex, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('Tabs 无障碍', () => {
  it('面板有 role=tabpanel', async () => {
    const { host, cleanup } = await mountTabs()
    expect(host.querySelector('[role=tabpanel]')).toBeTruthy()
    cleanup()
  })

  it('roving tabindex：只有当前标签可 Tab 停靠', async () => {
    const { buttons, cleanup } = await mountTabs()
    expect(buttons().map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    cleanup()
  })

  it('方向键切换选中，并把焦点带过去', async () => {
    const changes: string[] = []
    const { buttons, selectedIndex, press, cleanup } = await mountTabs(changes)

    buttons()[0].focus()
    await press('ArrowRight')
    expect(selectedIndex()).toBe(1)
    expect(changes).toEqual(['b'])
    expect(document.activeElement).toBe(buttons()[1])
    expect(buttons().map(b => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])

    cleanup()
  })

  it('两端回绕，Home/End 直达', async () => {
    const { buttons, selectedIndex, press, cleanup } = await mountTabs()

    buttons()[0].focus()
    await press('ArrowLeft')
    expect(selectedIndex()).toBe(2)          // 从第一个往左 → 回绕到最后一个

    await press('ArrowRight')
    expect(selectedIndex()).toBe(0)          // 从最后一个往右 → 回绕到第一个

    await press('End')
    expect(selectedIndex()).toBe(2)
    await press('Home')
    expect(selectedIndex()).toBe(0)

    cleanup()
  })

  it('方向键不会切换被禁用的标签', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const items: TabItem[] = [
      { id: 'a', label: 'A', content: () => createText('a') },
      { id: 'b', label: 'B', disabled: true, content: () => createText('b') },
      { id: 'c', label: 'C', content: () => createText('c') }
    ]
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(Tabs, { items }) })
    app.mount(host)
    await settle()

    const buttons = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
    buttons()[0].focus()
    await press0(buttons()[0])
    async function press0(el: HTMLElement): Promise<void> {
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await settle()
    }
    const selected = buttons().findIndex(b => b.getAttribute('aria-selected') === 'true')
    expect(buttons()[selected]?.getAttribute('data-tab-id')).toBe('c')   // 跳过禁用的 b

    app.destroy(); host.remove()
  })
})
