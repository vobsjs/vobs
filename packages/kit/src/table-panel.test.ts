import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitTablePanel } from './table-panel'

describe('@vobs/kit KitTablePanel', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('默认外壳：子内容直接落在面板内', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitTablePanel, { children: 'table content' })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-table-panel')
    expect(root?.textContent).toBe('table content')
    expect(root?.querySelector('.vobs-kit-table-panel__scroll')).toBeNull()
    expect(root?.classList.contains('vobs-kit-table-panel--pad')).toBe(false)
    app.destroy()
  })

  it('pad 修饰类：内边距自滚卡片', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitTablePanel, { pad: true, children: 'list' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-table-panel')?.classList.contains('vobs-kit-table-panel--pad')).toBe(true)
    app.destroy()
  })

  it('scroll 模式：子内容包进内部滚动层', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitTablePanel, { scroll: true, children: 'bare list' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-table-panel__scroll')?.textContent).toBe('bare list')
    app.destroy()
  })
})
