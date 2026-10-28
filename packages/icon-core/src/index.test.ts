import { beforeEach, describe, expect, it } from 'vitest'
import { createSvgIcon } from './index'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'

describe('@vobs/icon-core', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('creates an SVG icon component that drops straight into a Vobs icon slot', () => {
    const Camera = createSvgIcon({
      name: 'camera',
      body: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>',
      viewBox: '0 0 24 24'
    })
    const container = document.createElement('main')
    const app = createVobs({ render: () => Camera({ size: 48, color: 'red', strokeWidth: 1 }) })
    app.mount(container)

    const root = container.firstElementChild as HTMLElement
    const svg = root.querySelector('svg')!
    expect(root.dataset.iconName).toBe('camera')
    expect(root.style.width).toBe('48px')
    expect(svg.getAttribute('width')).toBe('48')
    expect(svg.getAttribute('color')).toBe('red')
    expect(svg.getAttribute('stroke-width')).toBe('1')
    app.destroy()
  })

  it('reacts to dynamic size, ARIA and icon definition changes', () => {
    const size = state<number | undefined>(16)
    const label = state('Camera')
    const Camera = createSvgIcon({ name: 'camera', body: '<path d="M1"/>' })
    const container = document.createElement('main')
    const app = createVobs({ render: () => Camera({ get size() { return size.value }, get title() { return label.value } }) })
    app.mount(container)

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-label')).toBe('Camera')
    size.value = 24
    label.value = 'Photo'
    app.update()
    expect(root.style.width).toBe('24px')
    expect(root.getAttribute('aria-label')).toBe('Photo')
    expect(root.querySelector('title')?.textContent).toBe('Photo')
    app.destroy()
  })

  /*
   * The author-provided aria-label used to be deleted by the component itself:
   * `:122` wrote it via managedAttributes, then `:129` cleared it back to
   * undefined with `ariaLabel === undefined ? title : undefined`.
   * Verified: `Camera({'aria-label':'Foo'})` produced aria-label=null —
   * neither hidden nor named.
   */
  it('respects the author-provided aria-label (no longer deleted by itself)', () => {
    const Camera = createSvgIcon({ name: 'camera', body: '<path d="M1"/>' })
    const container = document.createElement('main')
    const app = createVobs({ render: () => Camera({ 'aria-label': 'Foo' }) })
    app.mount(container)

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-label')).toBe('Foo')
    expect(root.getAttribute('aria-hidden')).toBeNull()
    app.destroy()
  })

  it('falls back to aria-hidden only when no name is given at all', () => {
    const Camera = createSvgIcon({ name: 'camera', body: '<path d="M1"/>' })
    const container = document.createElement('main')
    const app = createVobs({ render: () => Camera({}) })
    app.mount(container)

    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.getAttribute('aria-label')).toBeNull()
    app.destroy()
  })
})
