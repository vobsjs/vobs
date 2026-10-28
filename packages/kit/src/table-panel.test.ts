import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitTablePanel } from './table-panel'

describe('@vobs/kit KitTablePanel', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('default shell: children land directly inside the panel', () => {
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

  it('pad modifier: padded self-scrolling card', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitTablePanel, { pad: true, children: 'list' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-table-panel')?.classList.contains('vobs-kit-table-panel--pad')).toBe(true)
    app.destroy()
  })

  it('scroll mode: children wrapped in an inner scroll layer', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitTablePanel, { scroll: true, children: 'bare list' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-table-panel__scroll')?.textContent).toBe('bare list')
    app.destroy()
  })
})
