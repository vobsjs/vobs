// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Segmented, type SegmentedProps } from './segmented'

/*
 * The Segmented opts shortcut form (2026-10-28).
 *
 * Background: both Finora machines hit the "Seg's value = the option label" dead end —
 * with string[] opts, selection wrote back the display label, so comparing against a semantic
 * id never matched. The cure = support the {id, label} object form: selection writes back the
 * id rather than the label; string options keep the old behavior (writing back themselves).
 */
const flush = () => { scheduler.flush(); scheduler.flush() }

function mountSegmented(props: SegmentedProps) {
  const host = document.createElement('div')
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(Segmented, props) })
  app.mount(host)
  flush()
  return { host, app }
}

const clickOption = (host: HTMLElement, index: number): void => {
  const buttons = host.querySelectorAll<HTMLButtonElement>('.vui-seg__opt')
  buttons[index]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  flush()
}

describe('Segmented opts shortcut form', () => {
  it('string options: render the label, selection writes back themselves (back-compat)', () => {
    const value = state('月')
    const { host } = mountSegmented({ opts: ['月', '季', '年'], bind: value })
    expect(host.querySelectorAll('.vui-seg__opt')).toHaveLength(3)
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('月')

    clickOption(host, 1)
    expect(value.value).toBe('季')
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('季')
  })

  it('object options: display the label, selection writes back the id (cures "value = label")', () => {
    const value = state('login')
    const seen: string[] = []
    const { host } = mountSegmented({
      opts: [{ id: 'login', label: '登录' }, { id: 'register', label: '注册企业' }],
      bind: value,
      onChange: id => seen.push(id)
    })
    expect(host.querySelectorAll('.vui-seg__opt')).toHaveLength(2)
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('登录')

    clickOption(host, 1)
    // Core assertion: the semantic id is written back, not the display label「注册企业」
    expect(value.value).toBe('register')
    expect(seen).toEqual(['register'])
  })

  it('controlled highlight of object options follows the id (writing an id syncs; writing a label does not mis-highlight)', () => {
    const value = state('login')
    const { host } = mountSegmented({
      opts: [{ id: 'login', label: '登录' }, { id: 'register', label: '注册企业' }],
      bind: value
    })
    value.value = 'register'
    flush()
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('注册企业')

    // A legacy label value (e.g. old data stored「注册企业」) matches no id — no highlight rather than a wrong one
    value.value = '注册企业'
    flush()
    expect(host.querySelector('.vui-seg__opt.is-active')).toBeNull()
  })

  it('items takes precedence over opts (when both are passed, items wins)', () => {
    const value = state('x')
    const { host } = mountSegmented({
      opts: ['a', 'b'],
      items: [{ id: 'x', label: 'X' }],
      bind: value
    })
    expect(host.querySelectorAll('.vui-seg__opt')).toHaveLength(1)
    expect(host.querySelector('.vui-seg__opt')?.textContent).toBe('X')
  })
})
