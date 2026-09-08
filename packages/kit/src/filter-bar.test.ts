import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitFilterBar } from './filter-bar'

describe('@vobs/kit KitFilterBar', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('renders filter controls and submits through onSearch', () => {
    const onSearch = vi.fn()
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitFilterBar, {
        children: 'Filters',
        onSearch
      })
    })
    app.mount(container)

    const form = container.querySelector('.vobs-kit-filter-bar') as HTMLFormElement
    expect(form.getAttribute('role')).toBe('search')
    expect(form.querySelector('.vobs-kit-filter-bar__fields')?.textContent).toBe('Filters')
    expect(form.querySelector('.vui-btn--brand')?.textContent).toBe('Search')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(onSearch).toHaveBeenCalledTimes(1)
    app.destroy()
  })

  it('supports reset and custom labels/actions', () => {
    const onReset = vi.fn()
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitFilterBar, {
        searchLabel: 'Apply',
        resetLabel: 'Clear',
        actions: 'More',
        onReset
      })
    })
    app.mount(container)

    const form = container.querySelector('form')!
    expect(form.textContent).toContain('Apply')
    expect(form.textContent).toContain('Clear')
    expect(form.textContent).toContain('More')
    form.dispatchEvent(new Event('reset', { bubbles: true }))
    expect(onReset).toHaveBeenCalledTimes(1)
    app.destroy()
  })
})
