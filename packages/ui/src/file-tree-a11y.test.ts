// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { FileTree, type FileTreeItem } from './index'

setRenderer(createDOMRenderer())

/*
 * FileTree 的键盘可达性。
 *
 * 原来每行 `tabIndex = 0`（除禁用行）—— 键盘用户按 Tab 要**依次穿过整棵树的每一行**才能走到
 * 后面的内容；而 `role="tree"`/`treeitem` 的标准模型是**整棵树只有一个 Tab 停靠点**，内部用
 * 方向键移动。而且它**没有任何方向键处理**（原有 keydown 只处理 Enter/Space）。
 *
 * 这里锁住：单一 Tab 停靠点、方向键移动焦点并选中、跳过禁用项、Home/End。
 * 聚焦/选中会触发行重建，所以断言前让出微任务。
 */
const settle = async (): Promise<void> => { scheduler.flush(); await null; await null }

const ITEMS: FileTreeItem[] = [
  { id: 'src', label: 'src', kind: 'folder', children: [{ id: 'main', label: 'main.ts', kind: 'file' }] },
  { id: 'readme', label: 'README.md', kind: 'file' },
  { id: 'lock', label: 'lock.json', kind: 'file', disabled: true }
]

async function mountTree(options: { expanded?: string[]; onSelect?: (id: string) => void } = {}) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => createComponent(FileTree, {
      items: ITEMS,
      defaultExpanded: options.expanded ?? [],
      onSelect: options.onSelect
    })
  })
  app.mount(host)
  await settle()
  const rowIds = (): string[] => [...host.querySelectorAll<HTMLElement>('[data-file-id]')]
    .map(row => row.getAttribute('data-file-id') ?? '')
  const row = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-file-id="${id}"]`)!
  const tabbable = (): string[] => [...host.querySelectorAll<HTMLElement>('[data-file-id]')]
    .filter(r => r.getAttribute('tabindex') === '0')
    .map(r => r.getAttribute('data-file-id') ?? '')
  const press = async (key: string): Promise<void> => {
    document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
    await settle()
  }
  return { host, rowIds, row, tabbable, press, cleanup: () => { app.destroy(); host.remove() } }
}

describe('FileTree 键盘可达性', () => {
  it('整棵树只有一个 Tab 停靠点（原来是每一行）', async () => {
    const { rowIds, tabbable, cleanup } = await mountTree()
    expect(rowIds().length).toBeGreaterThan(1)
    expect(tabbable()).toHaveLength(1)
    cleanup()
  })

  it('方向键移动焦点并选中，焦点跟随', async () => {
    const selected: string[] = []
    const { row, tabbable, press, cleanup } = await mountTree({ onSelect: id => selected.push(id) })

    row('src').focus()
    await settle()
    expect(tabbable()).toEqual(['src'])          // 焦点落到哪一行，哪一行就是停靠点

    await press('ArrowDown')
    expect(selected).toEqual(['readme'])
    expect(document.activeElement).toBe(row('readme'))
    expect(tabbable()).toEqual(['readme'])

    await press('ArrowUp')
    expect(document.activeElement).toBe(row('src'))

    cleanup()
  })

  it('跳过禁用行', async () => {
    const { row, press, cleanup } = await mountTree()
    row('readme').focus()
    await settle()
    await press('ArrowDown')
    // lock 是禁用的，不该停在那里（也不该越过树尾）
    expect(document.activeElement).toBe(row('readme'))
    cleanup()
  })

  it('Home / End 直达首尾（可见行）', async () => {
    const { row, press, cleanup } = await mountTree()
    row('readme').focus()
    await settle()
    await press('Home')
    expect(document.activeElement).toBe(row('src'))
    await press('End')
    expect(document.activeElement).toBe(row('readme'))
    cleanup()
  })

  it('回车/空格仍然激活行（原有行为没被方向键挤掉）', async () => {
    const selected: string[] = []
    const { row, cleanup } = await mountTree({ onSelect: id => selected.push(id) })
    row('readme').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(selected).toEqual(['readme'])
    cleanup()
  })
})
