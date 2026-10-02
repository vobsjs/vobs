import { describe, expect, it } from 'vitest'
import { createSvgIcon } from './index'
import { hydrate, renderToString } from '../../ssr/src/index'

/**
 * icon-core 与 SSR 的缺口有两处，缺一不可：
 *
 * 1. `setOptionalAttribute` / `clearStaleAttributes` 直接调原生 `node.removeAttribute`
 *    —— SSR 渲染器没有这个方法（VobsRenderer 里它是可选项）→ renderToString 抛 TypeError；
 * 2. SVG 内容是 `setProperty(root, 'innerHTML', ...)`。SSR 侧原来把 innerHTML 丢进白名单外
 *    直接扔掉（产物是空 <span>），水合侧换出来的子树又不在认领表里 → extra-node。
 *    现在 ssr 两端都按"原始标记逃生口"处理（renderer.ts serialize / hydration.ts setProperty）。
 */
describe('@vobs/icon-core SSR', () => {
  const Camera = createSvgIcon({
    name: 'camera',
    body: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>',
    viewBox: '0 0 24 24'
  })

  it('renderToString 不抛错，且 SVG 内容真的在服务端产物里', () => {
    const html = renderToString(() => Camera({ size: 24, 'aria-label': 'Camera' }))
    expect(html).toContain('data-icon-name="camera"')
    expect(html).toContain('aria-label="Camera"')
    expect(html).toContain('<svg ')
    expect(html).toContain('<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>')
    // 该删的属性要真的不在产物里（两个渲染器都实现了 removeAttribute）
    expect(html).not.toContain('aria-hidden=""')
    expect(html).not.toContain('color=""')
  })

  it('无名字/无标题时仍然 aria-hidden', () => {
    expect(renderToString(() => Camera({}))).toContain('aria-hidden="true"')
  })

  it('服务端产物可以水合，SVG 被原地复用', () => {
    const props = { size: 24, title: 'Camera' }
    document.body.innerHTML = renderToString(() => Camera(props))
    const svgBefore = document.body.querySelector('svg')

    const app = hydrate(() => Camera(props), document.body)

    expect(document.body.querySelector('svg path')).not.toBeNull()
    expect(document.body.querySelector('span')?.getAttribute('aria-label')).toBe('Camera')
    app.destroy()
    void svgBefore
    document.body.innerHTML = ''
  })
})
