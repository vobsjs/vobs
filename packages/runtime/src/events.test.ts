// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { addEventListener, createElement, removeEventListener } from './index'

describe('event binding dedupe', () => {
  it('replaces a previous binding for the same node and event', () => {
    setRenderer(createDOMRenderer())
    const node = createElement('button')
    let first = 0
    let second = 0
    addEventListener(node, 'click', () => { first++ })
    addEventListener(node, 'click', () => { second++ })
    node.dispatchEvent(new MouseEvent('click'))
    expect(first).toBe(0)
    expect(second).toBe(1)
    removeEventListener(node, 'click', (() => undefined) as EventListener)
    node.dispatchEvent(new MouseEvent('click'))
    expect(second).toBe(1)
  })
})
