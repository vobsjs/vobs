// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/*
 * The sneakiest class of hydration difference: the server rendered **non-empty** text while
 * the client currently wants an empty text node (typically `createText('')` overwritten by
 * a bound effect later) — it just claims without reporting, so "server Ada / client forgot
 * to pass state and renders loading" — a value silently swapped — was completely silent.
 *
 * Round 13 added the observable outlet (`hydrationProvisionalText`); this round completes
 * the **semantics**: with `strictHydration` on, a hydration mismatch is thrown directly,
 * while the default keeps the original behavior (existing apps unaffected).
 */
describe('hydration: provisional claiming of non-empty text (strictHydration)', () => {
  const render = () => {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => 'count: 42')
    return span
  }

  it('default (non-strict): claims as before and completes hydration, behavior unchanged', () => {
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    expect(document.body.textContent).toBe('count: 42')
    app.destroy()
    document.body.innerHTML = ''
  })

  it('strictHydration: the same scenario throws a hydration mismatch directly (kind=content)', () => {
    document.body.innerHTML = renderToString(render)
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(render, document.body, { strictHydration: true })
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('content')
    expect(error?.vobsHydration?.actual).toContain('count: 42')
    document.body.innerHTML = ''
  })

  it('strictHydration does not false-positive on the legitimate "server empty text (placeholder comment)" shape', () => {
    const renderEmpty = () => {
      const span = createElement('span')
      insertBefore(span, createText(''), null)
      return span
    }
    document.body.innerHTML = renderToString(renderEmpty)
    const app = hydrate(renderEmpty, document.body, { strictHydration: true })
    expect(document.body.querySelector('span')).not.toBeNull()
    app.destroy()
    document.body.innerHTML = ''
  })
})
