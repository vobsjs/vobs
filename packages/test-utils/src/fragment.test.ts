import { describe, expect, it } from 'vitest'
import { createElement, createFragment, createText, createVobs, insertBefore, insertDynamic, state } from '@vobs/vobs'

describe('Fragment', () => {
  it('渲染多个同级节点且不产生元素包装', () => {
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

  it('能作为动态分支插入和移除整个节点范围', () => {
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
