import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitToolbarBar } from './toolbar-bar'

describe('@vobs/kit KitToolbarBar', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('left and right regions land in place with paired class names', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitToolbarBar, { left: 'filters', right: 'actions' })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-toolbar-bar')
    expect(root).not.toBeNull()
    expect(root?.querySelector('.vobs-kit-toolbar-bar__left')?.textContent).toBe('filters')
    expect(root?.querySelector('.vobs-kit-toolbar-bar__right')?.textContent).toBe('actions')
    app.destroy()
  })

  it('left only produces no empty right region', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitToolbarBar, { left: 'only' })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-toolbar-bar')
    expect(root?.querySelector('.vobs-kit-toolbar-bar__left')?.textContent).toBe('only')
    expect(root?.querySelector('.vobs-kit-toolbar-bar__right')).toBeNull()
    app.destroy()
  })

  it('the author\'s class merges with the base class', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitToolbarBar, { class: 'my-page-toolbar' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-toolbar-bar')?.classList.contains('my-page-toolbar')).toBe(true)
    app.destroy()
  })
})
