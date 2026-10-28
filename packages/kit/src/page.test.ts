import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitPage, KitPageHeader } from './page'

describe('@vobs/kit page primitives', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('KitPage uses UI-free title and actions slots', () => {
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

  it('KitPage allows fully replacing the header', () => {
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

  it('KitPage renders toolbar as a page-level region', () => {
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

  it('no toolbar prop means no empty page-level region', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPage, { title: 'Users', children: 'Content' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-page__toolbar')).toBeNull()
    app.destroy()
  })
})
