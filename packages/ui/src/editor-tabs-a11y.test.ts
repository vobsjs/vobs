// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { EditorTabs, type EditorTabItem } from './index'

setRenderer(createDOMRenderer())

/*
 * EditorTabs 的无障碍。
 *
 * 原来行上有 `role="tab"`，容器却**没有任何角色** —— 屏幕阅读器找不到这些 tab 所属的 tablist；
 * 且方向键**只改选中、不移动焦点**：焦点停在旧行上，而旧行的 tabindex 因选中变化已变成 -1，
 * DOM 焦点与 aria-selected 分家，键盘用户下一步仍从旧位置出发。
 *
 * 聚焦要等更新落地（选中会触发标签行重建），断言前让出微任务。
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const TABS: EditorTabItem[] = ['a', 'b', 'c'].map(id => ({ id, label: id.toUpperCase() }))

async function mountEditorTabs(changes: string[] = []) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(EditorTabs, { tabs: TABS, onChange: (id: string) => changes.push(id) })
  })
  app.mount(host)
  await settle()
  const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
  const selectedIndex = (): number => rows().findIndex(r => r.getAttribute('aria-selected') === 'true')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, rows, selectedIndex, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('EditorTabs 无障碍', () => {
  it('容器有 role=tablist（原来行上有 role=tab，却没地方归属）', async () => {
    const { host, cleanup } = await mountEditorTabs()
    expect(host.querySelector('[role=tablist]')).toBeTruthy()
    cleanup()
  })

  it('方向键切换选中，并把焦点带到新行', async () => {
    const changes: string[] = []
    const { rows, selectedIndex, press, cleanup } = await mountEditorTabs(changes)

    expect(rows().map(r => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    rows()[0].focus()

    await press('ArrowRight')
    expect(selectedIndex()).toBe(1)
    expect(changes).toEqual(['b'])
    expect(rows().map(r => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(document.activeElement).toBe(rows()[1])   // 原来焦点留在旧行上

    cleanup()
  })

  it('连续按方向键：每次都从新的当前位置继续', async () => {
    const { rows, selectedIndex, press, cleanup } = await mountEditorTabs()

    rows()[0].focus()
    await press('ArrowRight')
    await press('ArrowRight')
    expect(selectedIndex()).toBe(2)
    expect(document.activeElement).toBe(rows()[2])

    await press('ArrowLeft')
    expect(selectedIndex()).toBe(1)
    expect(document.activeElement).toBe(rows()[1])

    cleanup()
  })

  it('标签 id 里有引号也不会把键盘处理弄崩（不拼选择器）', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const tricky: EditorTabItem[] = [
      { id: 'a"b', label: 'A' },
      { id: 'c', label: 'C' }
    ]
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(EditorTabs, { tabs: tricky }) })
    app.mount(host)
    await settle()

    const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role=tab]')]
    rows()[0].focus()
    rows()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await settle()
    expect(document.activeElement).toBe(rows()[1])

    app.destroy(); host.remove()
  })
})
