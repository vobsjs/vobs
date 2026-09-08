import { beforeEach, describe, expect, it } from 'vitest'
import { createSvgIcon } from './index'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'

describe('@vobs/icon-core', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('创建可直接放入 Vobs icon 插槽的 SVG 图标组件', () => {
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

  it('响应动态尺寸、ARIA 和图标定义', () => {
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
})
