import { describe, expect, it } from 'vitest'
import { state } from '@vobs/vobs'
import { addEventListener, bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { mount } from './index'

describe('test-utils', () => {
  it('在内存渲染器中挂载、交互和更新', () => {
    const count = state(0)
    const app = mount(() => {
      const button = createElement('button')
      const text = createText('')
      insertBefore(button, text, null)
      bindText(text, () => `count: ${count.value}`)
      addEventListener(button, 'click', () => { count.value++ })
      return button
    })

    expect(app.queryByText('count: 0')).toBeTruthy()
    app.fireEvent('click', { target: 'button' })
    app.update()
    expect(app.queryByText('count: 1')).toBeTruthy()

    app.destroy()
    expect(app.container.children).toHaveLength(0)
  })
})
