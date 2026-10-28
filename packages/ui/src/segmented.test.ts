// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Segmented, type SegmentedProps } from './segmented'

/*
 * Segmented 的 opts 快捷形态（2026-10-28）。
 *
 * 背景：Finora 两机都踩过「Seg 的值 = 选项标签」死穴——string[] opts 选中写回
 * 展示标签，拿语义 id 比较永远不等。根治 = 支持 {id, label} 对象形态：选中写回
 * id 而非 label；字符串选项保持旧行为（写回自身）。
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

describe('Segmented opts 快捷形态', () => {
  it('字符串选项：渲染 label、选中写回自身（旧行为兼容）', () => {
    const value = state('月')
    const { host } = mountSegmented({ opts: ['月', '季', '年'], bind: value })
    expect(host.querySelectorAll('.vui-seg__opt')).toHaveLength(3)
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('月')

    clickOption(host, 1)
    expect(value.value).toBe('季')
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('季')
  })

  it('对象选项：展示 label，选中写回 id（根治「值 = 标签」）', () => {
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
    // 核心断言：写回的是语义 id，不是展示标签「注册企业」
    expect(value.value).toBe('register')
    expect(seen).toEqual(['register'])
  })

  it('对象选项的受控高亮跟随 id（外部写 id 同步，写标签不误亮）', () => {
    const value = state('login')
    const { host } = mountSegmented({
      opts: [{ id: 'login', label: '登录' }, { id: 'register', label: '注册企业' }],
      bind: value
    })
    value.value = 'register'
    flush()
    expect(host.querySelector('.vui-seg__opt.is-active')?.textContent).toBe('注册企业')

    // 存量标签值（如旧数据写了「注册企业」）不匹配任何 id —— 不高亮而非误亮
    value.value = '注册企业'
    flush()
    expect(host.querySelector('.vui-seg__opt.is-active')).toBeNull()
  })

  it('items 优先于 opts（同传时 items 赢）', () => {
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
