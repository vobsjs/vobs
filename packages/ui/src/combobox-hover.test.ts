// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Combobox } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Combobox hover performance.
 *
 * Previously the whole panel effect depended on `active` (read in two places inside it), and
 * `mousemove` changes `active` — so gliding the mouse across options **rebuilt every option**:
 * on a 50-item list, 10 mousemoves were measured to trigger 9 rebuilds, each round also calling
 * `list.replaceChildren()`. With direction auto, two extra `getBoundingClientRect()` calls
 * (forced layout) were thrown in on top.
 *
 * Now active is read with untrack (kept out of the dependency graph), and highlighting is handled
 * by an effect that only toggles classes. This locks in "node identity is preserved" — a rebuild
 * would swap the nodes out and this assertion would fail.
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
  it('hovering to another option does not rebuild option nodes (only toggles the highlight class)', async () => {
    const { items, hover, cleanup } = await mountCombobox()
    expect(items()).toHaveLength(20)

    const firstBefore = items()[0]
    await hover(5)
    // Node identity preserved ⇒ no replaceChildren + rebuild
    expect(items()[0]).toBe(firstBefore)
    expect(items()).toHaveLength(20)
    expect(items()[5].classList.contains('is-active')).toBe(true)
    expect(items()[0].classList.contains('is-active')).toBe(false)
    cleanup()
  })

  it('consecutive hovering also does not rebuild, and exactly one item stays highlighted', async () => {
    const { items, hover, cleanup } = await mountCombobox()
    const firstBefore = items()[0]

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await hover(index)

    expect(items()[0]).toBe(firstBefore)
    expect(items().filter(item => item.classList.contains('is-active'))).toHaveLength(1)
    expect(items()[9].classList.contains('is-active')).toBe(true)
    cleanup()
  })
})
