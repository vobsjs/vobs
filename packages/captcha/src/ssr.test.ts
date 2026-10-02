import { describe, expect, it } from 'vitest'
import { Captcha, SliderCaptcha } from './index'
import { hydrate, renderToString } from '../../ssr/src/index'

/**
 * SSR 渲染器（ssr/src/renderer.ts）**没有** removeAttribute —— 它在 `VobsRenderer`
 * 里是可选能力（runtime/src/renderer.ts:21），服务端数据节点上也没有 DOM 的原生方法。
 * 组件里直接调 `node.removeAttribute(...)` 会让 renderToString 整棵树抛 TypeError。
 */
describe('@vobs/captcha SSR', () => {
  it('renderToString 不抛错：属性清除走框架 op 而不是原生 DOM 方法', () => {
    const html = renderToString(() => Captcha({ status: 'idle' }))
    expect(html).toContain('class="vobs-captcha"')
    expect(html).toContain('data-status="idle"')
  })

  it('disabled / aria-* / SliderCaptcha 都不再崩，且 label 进入服务端产物', () => {
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

  it('服务端产物可以被水合回同一棵树', () => {
    const props = { status: 'ready' as const, label: 'Human check' }
    document.body.innerHTML = renderToString(() => Captcha(props))

    const app = hydrate(() => Captcha(props), document.body)
    expect(document.body.querySelector('.vobs-captcha')).not.toBeNull()
    expect(document.body.querySelector('.vobs-captcha__header')?.textContent).toBe('Human check')
    app.destroy()
    document.body.innerHTML = ''
  })
})
