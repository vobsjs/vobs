import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitPageActions } from './page-actions'

describe('@vobs/kit KitPageActions', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('renders an accessible action group with alignment', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitPageActions, {
        align: 'between',
        children: 'Actions'
      })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-page-actions')
    expect(root?.getAttribute('role')).toBe('group')
    expect(root?.classList.contains('vobs-kit-page-actions--between')).toBe(true)
    expect(root?.textContent).toBe('Actions')
    app.destroy()
  })
})
