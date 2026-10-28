// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createElement, createText, setRenderer } from '@vobs/vobs'
import { mount } from './index'

/*
 * test-utils' `mount()` installs the test renderer into the **process-level**
 * `setRenderer` singleton. It used to register no cleanup at all: as soon as one test
 * forgot `destroy()`, **every subsequent** DOM test in the same file got plain objects
 * `{type,tag,attrs,…}` instead of DOM nodes from `createElement` — and vitest isolates
 * per file, so "running this file alone" never shows it (the classic "green alone, red together").
 *
 * Key point: a beforeEach that re-installs the DOM renderer must **not** be used here
 * (it would mask the pollution); the renderer is installed once at module scope so the
 * cleanup logic is the only restoring factor between the two tests.
 */
setRenderer(createDOMRenderer())

describe('auto cleanup of test-utils mount', () => {
  it('first test deliberately skips destroy()', () => {
    const view = mount(() => createText('leaked'))
    expect(view.container).toBeDefined()
    // deliberately not calling view.destroy()
  })

  it('the previous test did not destroy, yet the global renderer must already be restored for this one', () => {
    expect(createElement('div')).toBeInstanceOf(Element)
  })
})
