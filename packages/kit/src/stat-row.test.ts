import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitStatRow } from './stat-row'

describe('@vobs/kit KitStatRow', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('defaults to 3 columns', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitStatRow, { children: 'stat' })
    })
    app.mount(container)

    const root = container.querySelector('.vobs-kit-stat-row')
    expect(root?.classList.contains('vobs-kit-stat-row--cols-3')).toBe(true)
    expect(root?.textContent).toBe('stat')
    app.destroy()
  })

  it('cols=4 switches the variant', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(KitStatRow, { cols: 4, children: 'stat' })
    })
    app.mount(container)

    expect(container.querySelector('.vobs-kit-stat-row')?.classList.contains('vobs-kit-stat-row--cols-4')).toBe(true)
    app.destroy()
  })
})
