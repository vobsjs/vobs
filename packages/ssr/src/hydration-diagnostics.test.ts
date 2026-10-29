// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, createText, insertBefore } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/*
 * In hydration-failure diagnostics, `kind: 'content'` used to be **unreachable**: actual
 * came from `container.querySelectorAll('*')` (elements only) while the predicate checked
 * `actual?.nodeType === 3`. So the most typical hydration difference — "expected some text
 * but the DOM holds different text" — was only reported as `missing-node` with
 * `actual=<none>`, hiding the real content during debugging.
 */
describe('hydration diagnostics: the content branch when text is expected', () => {
  const render = (value: string) => () => {
    const heading = createElement('h1')
    insertBefore(heading, createText(value), null)
    return heading
  }

  it('reports content with the real text when the DOM holds different text', () => {
    document.body.innerHTML = renderToString(render('Bob'))
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(render('Ada'), document.body)
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('content')
    expect(error?.vobsHydration?.actual).toContain('Bob')
    document.body.innerHTML = ''
  })

  it('still reports missing-node when the structure truly lacks a node (diagnostics not hardcoded to content)', () => {
    document.body.innerHTML = renderToString(() => createElement('h1'))
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(() => createElement('p'), document.body)
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('missing-node')
    expect(error?.vobsHydration?.actual).toContain('h1')
    document.body.innerHTML = ''
  })
})
