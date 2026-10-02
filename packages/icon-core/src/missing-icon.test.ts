// @vitest-environment jsdom
/*
 * 图标查表 miss **不能静默**（外部踩坑文档 H 条：lucide 图标白名单静默空白）。
 *
 * 机制：应用侧「名字 → 图标定义」查表 miss 时返回空，渲染成空 `<span>`，不报错 ——
 * 于是新增页面用了没登记的图标时，界面上只是"那里没有东西"，靠人眼发现。
 * 文档记的是已经踩过三次变体（keyboard / upload-cloud / triangle-alert，
 * 以及 `ICONS` / `FAVORITES` 双清单混淆）。
 *
 * 框架修不了应用的白名单（查表在应用侧），但能**把 miss 这件事说出来** ——
 * 这就是本文件锁的行为。
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createSvgIconNode, type SvgIconDefinition } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('图标缺失时的可观测性', () => {
  it('definition 为 undefined + 提供了名字 → 警告并报出名字', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({
        render: () => createSvgIconNode(undefined as never, {} as never, { dataIconName: 'keyboard' } as never)
      })
      app.mount(host)
      settle()

      expect(host.querySelector('span')?.innerHTML).toBe('')   // 仍然是空（不改变渲染语义）
      const calls = warn.mock.calls.map(call => String(call[0])).join('\n')
      expect(calls, '缺失图标没有发出任何提示（这就是 H 条的静默空白）').toContain('keyboard')
      expect(calls).toContain('没有定义')
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('没有名字时也给一条通用警告（仍然不静默）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createSvgIconNode(undefined as never) })
      app.mount(host)
      settle()
      expect(warn.mock.calls.length, '完全无声').toBeGreaterThan(0)
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('同一个缺失名字只警告一次（effect 重跑不刷屏）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (let i = 0; i < 3; i++) {
        const host = document.createElement('main')
        document.body.appendChild(host)
        const app = createVobs({
          render: () => createSvgIconNode(undefined as never, {} as never, { dataIconName: 'upload-cloud' } as never)
        })
        app.mount(host)
        settle()
        app.destroy(); host.remove()
      }
      const aboutUpload = warn.mock.calls
        .map(call => String(call[0]))
        .filter(text => text.includes('upload-cloud'))
      expect(aboutUpload, '同一个缺失名字被重复警告').toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('定义存在时**不**警告（正常路径不受影响）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const pen: SvgIconDefinition = { name: 'pen', body: '<path d="M4 4 L20 20" />' }
      const host = document.createElement('main')
      document.body.appendChild(host)
      const app = createVobs({ render: () => createSvgIconNode(pen) })
      app.mount(host)
      settle()
      expect(host.querySelector('svg'), '正常图标没渲染出来').not.toBeNull()
      expect(warn, `正常路径发出了警告: ${warn.mock.calls.map(c => String(c[0])).join(' | ')}`).not.toHaveBeenCalled()
      app.destroy(); host.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it('有定义时 data-icon-name 照常带上（既有行为不变）', () => {
    const pen: SvgIconDefinition = { name: 'pen', body: '<path d="M4 4 L20 20" />' }
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({ render: () => createSvgIconNode(pen) })
    app.mount(host)
    settle()
    expect(host.querySelector('[data-icon-name="pen"]')).not.toBeNull()
    app.destroy(); host.remove()
  })
})
