// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Combobox } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Combobox 的 hover 性能。
 *
 * 原来整个面板 effect 依赖 `active`（它在里面被读了两处），而 `mousemove` 会改 `active`
 * —— 于是鼠标在选项上滑过就把**全部选项重建一遍**：50 项列表上 10 次 mousemove 实测重建 9 次，
 * 而且每轮都会 `list.replaceChildren()`。方向为 auto 时还会顺带两次
 * `getBoundingClientRect()`（强制 layout）。
 *
 * 现在 active 用 untrack 读（不进依赖），高亮由一个只切 class 的 effect 负责。
 * 这里锁住"节点身份不变"——重建的话节点会被换掉，这条断言就会失败。
 */
const OPTIONS = Array.from({ length: 20 }, (_, i) => ({ label: `opt${i}`, value: `v${i}` }))

async function mountCombobox() {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(Combobox, { options: OPTIONS }) })
  app.mount(host)

  const input = host.querySelector('input') as HTMLInputElement
  input.focus()
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  await settle()

  const items = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('button')]
    .filter(button => button.className.includes('vui-combobox__option'))
  const hover = async (index: number): Promise<void> => {
    items()[index].dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }))
    await settle()
  }
  return { host, items, hover, cleanup: () => { app.destroy(); host.remove() } }
}

describe('Combobox hover', () => {
  it('hover 换项不重建选项节点（只切高亮 class）', async () => {
    const { items, hover, cleanup } = await mountCombobox()
    expect(items()).toHaveLength(20)

    const firstBefore = items()[0]
    await hover(5)
    // 节点身份不变 ⇒ 没有 replaceChildren + 重建
    expect(items()[0]).toBe(firstBefore)
    expect(items()).toHaveLength(20)
    expect(items()[5].classList.contains('is-active')).toBe(true)
    expect(items()[0].classList.contains('is-active')).toBe(false)
    cleanup()
  })

  it('连续 hover 也不重建，且高亮始终只有一项', async () => {
    const { items, hover, cleanup } = await mountCombobox()
    const firstBefore = items()[0]

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await hover(index)

    expect(items()[0]).toBe(firstBefore)
    expect(items().filter(item => item.classList.contains('is-active'))).toHaveLength(1)
    expect(items()[9].classList.contains('is-active')).toBe(true)
    cleanup()
  })
})
