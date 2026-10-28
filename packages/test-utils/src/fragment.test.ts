import { describe, expect, it } from 'vitest'
import { createElement, createFragment, createText, createVobs, insertBefore, insertDynamic, state } from '@vobs/vobs'

describe('Fragment', () => {
  it('renders multiple sibling nodes without an element wrapper', () => {
    const app = createVobs({
      render: () => createFragment((parent, anchor) => {
        insertBefore(parent, createText('one'), anchor)
        insertBefore(parent, createText('two'), anchor)
      })
    })
    const container = document.createElement('div')
    app.mount(container)

    expect(container.textContent).toBe('onetwo')
    expect(container.children).toHaveLength(0)
    app.destroy()
  })

  it('can be inserted and removed as a dynamic branch covering the whole node range', () => {
    const visible = state(true)
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertDynamic(root, null, () => visible.value ? createFragment((parent, anchor) => {
          insertBefore(parent, createText('one'), anchor)
          insertBefore(parent, createText('two'), anchor)
        }) : null)
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    expect(container.textContent).toBe('onetwo')

    visible.value = false
    app.update()
    expect(container.textContent).toBe('')
    app.destroy()
  })
})
