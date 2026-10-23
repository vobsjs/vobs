import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitToolbarBar } from './toolbar-bar'

describe('@vobs/kit KitToolbarBar', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('左区右区各归其位，类名成对出现', () => {
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

  it('只传 left 不产生空 right 区', () => {
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

  it('作者的 class 与基类合并', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitToolbarBar, { class: 'my-page-toolbar' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-toolbar-bar')?.classList.contains('my-page-toolbar')).toBe(true)
    app.destroy()
  })
})
