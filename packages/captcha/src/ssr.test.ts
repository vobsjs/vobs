import { describe, expect, it } from 'vitest'
import { Captcha, SliderCaptcha } from './index'
import { hydrate, renderToString } from '../../ssr/src/index'

/**
 * The SSR renderer (ssr/src/renderer.ts) does **not** have removeAttribute — it is an optional
 * capability on `VobsRenderer` (runtime/src/renderer.ts:21), and server-side data nodes have no
 * native DOM methods either. Calling `node.removeAttribute(...)` directly in a component would
 * make renderToString throw a TypeError across the whole tree.
 */
describe('@vobs/captcha SSR', () => {
  it('renderToString does not throw: attribute removal goes through framework ops instead of native DOM methods', () => {
    const html = renderToString(() => Captcha({ status: 'idle' }))
    expect(html).toContain('class="vobs-captcha"')
    expect(html).toContain('data-status="idle"')
  })

  it('disabled / aria-* / SliderCaptcha no longer crash, and label lands in the server output', () => {
    expect(renderToString(() => Captcha({ status: 'ready', disabled: true })))
      .toContain('aria-disabled="true"')
    expect(renderToString(() => Captcha({ status: 'ready', 'aria-label': 'Security check' })))
      .toContain('aria-label="Security check"')
    expect(renderToString(() => Captcha({ status: 'ready', label: 'Human check' })))
      .toContain('>Human check<')
    expect(renderToString(() => SliderCaptcha({
      challenge: {
        id: 'c1',
        expiresAt: 60_000,
        payload: { width: 300, height: 160, targetX: 120, targetY: 40, pieceWidth: 48, pieceHeight: 48 }
      }
    }))).toContain('vobs-captcha')
  })

  it('server output can be hydrated back into the same tree', () => {
    const props = { status: 'ready' as const, label: 'Human check' }
    document.body.innerHTML = renderToString(() => Captcha(props))

    const app = hydrate(() => Captcha(props), document.body)
    expect(document.body.querySelector('.vobs-captcha')).not.toBeNull()
    expect(document.body.querySelector('.vobs-captcha__header')?.textContent).toBe('Human check')
    app.destroy()
    document.body.innerHTML = ''
  })
})
