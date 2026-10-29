import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, setRenderer } from '@vobs/vobs'
import { hydrate, renderToString } from './index'

/**
 * `setRenderer` is a **process-level singleton** (runtime/src/ops.ts:20). Applications
 * install their own renderer on mount, but it used to **not be restored on destroy** —
 * after one `renderToString` (internally mount → destroy), the global renderer stayed stuck
 * on the SSR renderer forever: any later `createElement` in the same process returned a
 * plain data object (no tagName), property operations on real DOM nodes threw, and two
 * requests even interleaved within the await window of `renderToStringAsync`.
 *
 * Hydration failure is analogous: `hydration.ts` only reset `hydrating` to false on the
 * **success** path in `completeHydration()`, so after a failure the global renderer stayed
 * on the "currently claiming DOM" instance, cascading errors.
 */
describe('the SSR renderer does not pollute the process', () => {
  it('the global renderer is restored after renderToString (createElement still yields real DOM)', () => {
    setRenderer(createDOMRenderer())
    const html = renderToString(() => createElement('div'))
    expect(html).toBe('<div></div>')

    const node = createElement('span')
    expect(node).toBeInstanceOf(Element)
    expect((node as unknown as { tagName: string }).tagName).toBe('SPAN')
  })

  it('the global renderer is also restored after hydration failure', () => {
    setRenderer(createDOMRenderer())
    document.body.innerHTML = renderToString(() => createElement('h1'))

    expect(() => hydrate(() => createElement('p'), document.body)).toThrow('hydration')

    const node = createElement('span')
    expect(node).toBeInstanceOf(Element)
    document.body.innerHTML = ''
  })
})
