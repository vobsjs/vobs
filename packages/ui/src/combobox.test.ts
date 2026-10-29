// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Combobox } from './combobox'
import { state } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))

async function mount(props?: Parameters<typeof Combobox>[0]): Promise<HTMLElement> {
  setRenderer(createDOMRenderer())
  const root = Combobox(props) as HTMLElement
  await tick()
  return root
}

describe('Combobox', () => {
  const FRUITS = [
    { value: 'apple', label: '苹果' },
    { value: 'banana', label: '香蕉' },
    { value: 'cherry', label: '樱桃' }
  ]

  it('filters options by input and selects on click (bind write-back)', async () => {
    const bind = state('apple')
    const root = await mount({ options: FRUITS, bind, emptyText: '没有匹配' })
    const input = root.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('苹果')

    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    expect(root.querySelector('.vui-combobox__panel')).not.toBeNull()

    input.value = '香'
    input.dispatchEvent(new Event('input'))
    await tick()
    const options = root.querySelectorAll('.vui-combobox__option')
    expect(options.length).toBe(1)
    expect(options[0]!.textContent).toBe('香蕉')
    ;(options[0] as HTMLElement).click()
    await tick()
    expect(bind.value).toBe('banana')
    expect(input.value).toBe('香蕉')
    expect(root.querySelector('.vui-combobox__panel')).toBeNull()
  })

  it('shows emptyText when nothing matches', async () => {
    const root = await mount({ options: FRUITS, value: 'apple', emptyText: '没有匹配' })
    const input = root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    input.value = '不存在'
    input.dispatchEvent(new Event('input'))
    await tick()
    expect(root.querySelector('.vui-combobox__empty')?.textContent).toBe('没有匹配')
  })

  it('ArrowDown + Enter selects the next option', async () => {
    const bind = state('apple')
    const root = await mount({ options: FRUITS, bind })
    const input = root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await tick()
    expect(bind.value).toBe('banana')
    expect(input.value).toBe('香蕉')
  })

  it('outside click closes the panel', async () => {
    const root = await mount({ options: FRUITS, value: 'apple' })
    const input = root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    expect(root.querySelector('.vui-combobox__panel')).not.toBeNull()
    document.body.click()
    await tick()
    expect(root.querySelector('.vui-combobox__panel')).toBeNull()
  })

  it('focusing while disabled does not open the panel', async () => {
    const root = await mount({ options: FRUITS, value: 'apple', disabled: true })
    const input = root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    expect(root.querySelector('.vui-combobox__panel')).toBeNull()
  })

  it('align="end" and direction="up" emit the corresponding modifier classes', async () => {
    const root = await mount({ options: FRUITS, value: 'apple', align: 'end', direction: 'up' })
    expect(root.classList.contains('vui-combobox--align-end')).toBe(true)
    expect(root.classList.contains('vui-combobox--up')).toBe(true)
  })

  it('direction defaults to down: no up class, and auto stays down when the viewport has room', async () => {
    const fallback = await mount({ options: FRUITS, value: 'apple' })
    expect(fallback.classList.contains('vui-combobox--up')).toBe(false)
    const auto = await mount({ options: FRUITS, value: 'apple', direction: 'auto' })
    const input = auto.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new FocusEvent('focus'))
    await tick()
    expect(auto.querySelector('.vui-combobox__panel')).not.toBeNull()
    // The jsdom viewport (innerHeight 768) is far taller than the panel: auto does not flip
    expect(auto.classList.contains('vui-combobox--up')).toBe(false)
  })
})
