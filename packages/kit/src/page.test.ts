import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitPage, KitPageHeader } from './page'

describe('@vobs/kit page primitives', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('KitPage 使用无 UI 依赖的标题和 actions 插槽', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPage, {
        title: 'Users',
        description: 'Manage users',
        actions: 'Create',
        children: 'Table content'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-page')).toBeTruthy()
    expect(container.querySelector('.vobs-kit-page-header__title')?.textContent).toBe('Users')
    expect(container.querySelector('.vobs-kit-page-header__description')?.textContent).toBe('Manage users')
    expect(container.querySelector('.vobs-kit-page-header__actions')?.textContent).toBe('Create')
    expect(container.querySelector('.vobs-kit-page__content')?.textContent).toBe('Table content')
    app.destroy()
  })

  it('KitPage 可以完全替换 header', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPage, {
        header: createComponent(KitPageHeader, { title: 'Custom' }),
        title: 'Ignored',
        children: 'Content'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-page-header__title')?.textContent).toBe('Custom')
    expect(container.querySelector('.vobs-kit-page-header__title')?.textContent).not.toBe('Ignored')
    app.destroy()
  })

  it('KitPage 将 toolbar 渲染为页面级区域', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPage, {
        title: 'Users',
        toolbar: 'Search controls',
        children: 'Table content'
      })
    })
    app.mount(container)

    const toolbar = container.querySelector('.vobs-kit-page__toolbar')
    expect(toolbar?.textContent).toBe('Search controls')
    expect(toolbar?.nextElementSibling?.classList.contains('vobs-kit-page__content')).toBe(true)
    app.destroy()
  })

  it('没有 toolbar 时不生成空的页面级区域', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPage, { title: 'Users', children: 'Content' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-page__toolbar')).toBeNull()
    app.destroy()
  })
})
