import { describe, expect, it } from 'vitest'
import { createElement, setProperty } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/**
 * `setProperty(node, 'innerHTML', markup)` is the framework's only "raw markup" escape hatch
 * (icon-core SVG and the ui/combobox dropdown arrow both rely on it). But it used to fail on
 * both ends:
 *
 * - Server: `serializeAttributes`'s whitelist only knows value/tabIndex/className/boolean
 *   attributes; innerHTML is neither an attribute nor one of those properties →
 *   **the whole <svg> silently vanished**;
 * - Client hydration: `Reflect.set(node, 'innerHTML', ...)` really swaps out the child
 *   nodes, and the new nodes are not in the claim table → `assertAllNodesClaimed` throws
 *   `extra-node`.
 *
 * So "components put raw markup via innerHTML" was simply unworkable under SSR + hydration.
 */
describe('the innerHTML escape hatch in SSR', () => {  const markup = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1"/></svg>'
  const render = () => {
    const span = createElement('span')
    setProperty(span, 'innerHTML', markup)
    return span
  }

  it('server output preserves raw markup', () => {
    expect(renderToString(render)).toBe(`<span>${markup}</span>`)
  })

  it('output hydrates, and subtrees swapped in via innerHTML are not treated as extra nodes', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    expect(document.body.querySelector('svg path')?.getAttribute('d')).toBe('M1')
    app.destroy()
    document.body.innerHTML = ''
  })
})
