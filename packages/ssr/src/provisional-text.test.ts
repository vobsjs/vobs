// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { setRuntimeDebugHooks, type RuntimeProvisionalText } from '@vobs/runtime'
import { hydrate, renderToString } from './index'

/*
 * During hydration, the `createText('')` fallback branch claims **any unclaimed text**
 * (the server rendered real text while the client currently wants empty text: it can only
 * be claimed first and overwritten by the bound effect later). This used to be completely
 * silent — server "Ada" meeting a client that forgot to pass state (rendering "loading")
 * quietly became the latter, with no error and no clue.
 * There is now an observable outlet: `hydrationProvisionalText`.
 */
describe('provisional text claiming during hydration has an observable outlet', () => {
  function render() {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => 'count: 42')
    return span
  }

  it('server non-empty text + client empty initial value: fires one hydrationProvisionalText', () => {
    const events: RuntimeProvisionalText[] = []
    setRuntimeDebugHooks({ hydrationProvisionalText: event => events.push(event) })
    try {
      document.body.innerHTML = renderToString(render)
      const app = hydrate(render, document.body)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ expected: 'dynamic text node', actual: '"count: 42"' })
      // The value itself is still overwritten by the bound effect (behavior unchanged)
      expect(document.body.textContent).toBe('count: 42')
      app.destroy()
    } finally {
      setRuntimeDebugHooks(null)
      document.body.innerHTML = ''
    }
  })

  it('server empty text (placeholder comment) does not go through provisional claiming and emits no event', () => {
    const events: RuntimeProvisionalText[] = []
    const renderEmpty = () => {
      const span = createElement('span')
      insertBefore(span, createText(''), null)
      return span
    }
    setRuntimeDebugHooks({ hydrationProvisionalText: event => events.push(event) })
    try {
      document.body.innerHTML = renderToString(renderEmpty)
      const app = hydrate(renderEmpty, document.body)
      expect(events).toHaveLength(0)
      app.destroy()
    } finally {
      setRuntimeDebugHooks(null)
      document.body.innerHTML = ''
    }
  })
})
