// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hydrate, renderToString } from '@vobs/ssr'
import { bindText, createElement, createText, insertBefore } from '@vobs/vobs'
import { createDevTools } from './index'

/*
 * ssr emits `hydrationProvisionalText` when "a non-empty text is temporarily claimed during
 * hydration" (the server rendered real text, the client needs empty text at that moment until a
 * binding effect overwrites it — this kind of "value quietly swapped out" used to be fully
 * silent). This test pins that devtools really catches it: otherwise that observable outlet has
 * nobody listening.
 */
describe('@vobs/devtools catches hydration provisional claims', () => {
  it('hydrationProvisionalText is recorded as a lifecycle event', () => {
    const devtools = createDevTools({ expose: false })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }

    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)

    const events = devtools.getLifecycleEvents().filter(event => event.type === 'hydration-provisional-text')
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toContain('count: 42')

    app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })
})
