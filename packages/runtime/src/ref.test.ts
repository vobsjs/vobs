// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs } from '@vobs/vobs'
import { createElement, createText, insertBefore, ref, setRef } from './index'

describe('ref', () => {
  it('assigns host nodes and clears them when the app is destroyed', () => {
    const target = document.createElement('div')
    const nodeRef = ref<Element>()
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => {
        const node = createElement('input')
        setRef(node, nodeRef)
        insertBefore(target, node, null)
        return createText('')
      }
    })
    app.mount(target)
    expect(nodeRef.current).toBeInstanceOf(HTMLInputElement)
    app.destroy()
    expect(nodeRef.current).toBeNull()
  })
})
