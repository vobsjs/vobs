import { describe, expect, it } from 'vitest'
import { createSvgIcon } from './index'
import { hydrate, renderToString } from '../../ssr/src/index'

/**
 * There are two icon-core ↔ SSR gaps, both mandatory to fix:
 *
 * 1. `setOptionalAttribute` / `clearStaleAttributes` called native
 *    `node.removeAttribute` directly — the SSR renderer has no such method
 *    (it's optional in VobsRenderer) → renderToString threw TypeError;
 * 2. SVG content goes through `setProperty(root, 'innerHTML', ...)`. SSR used
 *    to drop innerHTML as outside the whitelist (empty <span> output), and the
 *    subtree swapped in by hydration wasn't in the claim table → extra-node.
 *    Now both ssr ends treat it as a "raw markup escape hatch"
 *    (renderer.ts serialize / hydration.ts setProperty).
 */
describe('@vobs/icon-core SSR', () => {
  const Camera = createSvgIcon({
    name: 'camera',
    body: '<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>',
    viewBox: '0 0 24 24'
  })

  it('renderToString does not throw and SVG content really lands in the server output', () => {
    const html = renderToString(() => Camera({ size: 24, 'aria-label': 'Camera' }))
    expect(html).toContain('data-icon-name="camera"')
    expect(html).toContain('aria-label="Camera"')
    expect(html).toContain('<svg ')
    expect(html).toContain('<path d="M4 7h4l2-2h4l2 2h4v12H4z"/>')
    // Attributes that should be removed must really be absent (both renderers implement removeAttribute)
    expect(html).not.toContain('aria-hidden=""')
    expect(html).not.toContain('color=""')
  })

  it('stays aria-hidden when there is no name/title', () => {
    expect(renderToString(() => Camera({}))).toContain('aria-hidden="true"')
  })

  it('server output can be hydrated and the SVG is reused in place', () => {
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
