import { beforeEach, describe, expect, it } from 'vitest'
import { state } from '@vobs/reactivity'
import {
  createComponent,
  createDOMRenderer,
  createElement,
  createText,
  createVobs,
  setRenderer
} from '@vobs/vobs'
import { Alert } from './alert'
import { Button } from './button'
import { Card } from './card'
import { Dialog } from './dialog'
import { Icon } from './icon'
import { Input } from './forms'
import { Tabs } from './tabs'
import { Tag } from './tag'

describe('@vobs/ui', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('Button merges external class and responds to dynamic disabled/loading', () => {
    const disabled = state(false)
    const loading = state(false)
    let clicks = 0
    const props = {
      get disabled() { return disabled.value },
      get loading() { return loading.value },
      class: 'consumer-button',
      className: 'another-class',
      children: 'Save',
      onClick: () => { clicks++ }
    }
    const container = document.createElement('main')
    const app = createVobs({ render: () => createComponent(Button, props) })
    app.mount(container)

    const button = container.querySelector('button')!
    expect(button.className).toContain('vui-btn')
    expect(button.className).toContain('consumer-button')
    expect(button.className).toContain('another-class')
    expect(button.textContent).toBe('Save')

    button.dispatchEvent(new MouseEvent('click'))
    expect(clicks).toBe(1)
    disabled.value = true
    app.update()
    expect(button.disabled).toBe(true)
    button.dispatchEvent(new MouseEvent('click'))
    expect(clicks).toBe(1)

    loading.value = true
    app.update()
    expect(button.getAttribute('aria-busy')).toBe('true')
    app.destroy()
  })

  it('Input uses a native input and hands controlled value and events to a user Signal', () => {
    const value = state('before')
    let inputEvent = 0
    const props = {
      get value() { return value.value },
      class: 'consumer-input',
      onInput: (event: InputEvent) => {
        inputEvent++
        value.value = (event.target as HTMLInputElement).value
      }
    }
    const container = document.createElement('main')
    const app = createVobs({ render: () => createComponent(Input, props) })
    app.mount(container)

    const root = container.querySelector('.vui-input')!
    const input = root.querySelector('input')!
    expect(root.className).toContain('consumer-input')
    expect(input.value).toBe('before')

    input.value = 'after'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    app.update()
    expect(inputEvent).toBe(1)
    expect(value.value).toBe('after')
    expect(input.value).toBe('after')
    app.destroy()
  })

  it('components accept third-party nodes as icon/children without implicit icon dependencies', () => {
    const externalIcon = createElement('svg')
    const externalLabel = createText('External')
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Button, {
        variant: 'secondary',
        icon: externalIcon,
        children: externalLabel
      })
    })
    app.mount(container)

    const button = container.querySelector('button')!
    expect(button.querySelector('svg')).toBe(externalIcon)
    expect(button.textContent).toBe('External')
    app.destroy()
  })

  it('structural components use the new vui- class contract', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        root.append(
          createComponent(Card, { title: 'Title', description: 'Description', class: 'consumer-card' }) as Node,
          createComponent(Tag, { tone: 'success', children: 'Ready' }) as Node,
          createComponent(Alert, { tone: 'info', title: 'Info', description: 'Details' }) as Node
        )
        return root
      }
    })
    app.mount(container)

    expect(container.querySelector('.vui-card')).toBeTruthy()
    expect(container.querySelector('.vui-card')?.classList.contains('consumer-card')).toBe(true)
    expect(container.querySelector('.vui-card__title')?.classList.contains('consumer-card')).toBe(false)
    expect(container.querySelector('.vui-card__title')?.textContent).toBe('Title')
    expect(container.querySelector('.vui-tag--success')?.textContent).toBe('Ready')
    expect(container.querySelector('.vui-alert--info')).toBeTruthy()
    expect(container.querySelector('[class*="ds-"]')).toBeNull()
    app.destroy()
  })

  it('Tabs updates the active tab in uncontrolled mode and notifies the consumer', () => {
    const changes: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Tabs, {
        items: [
          { id: 'overview', label: 'Overview', content: 'Overview content' },
          { id: 'activity', label: 'Activity', content: 'Activity content' }
        ],
        onChange: id => changes.push(id)
      })
    })
    app.mount(container)

    const tabs = container.querySelectorAll('[role="tab"]')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('.vui-tabs__panel')?.textContent).toBe('Overview content')
    ;(tabs[1] as HTMLElement).click()
    app.update()
    expect(changes).toEqual(['activity'])
    expect(container.querySelector('[data-tab-id="activity"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('.vui-tabs__panel')?.textContent).toBe('Activity content')
    app.destroy()
  })

  it('Dialog supports open, Escape, and the backdrop close reason', () => {
    const reasons: string[] = []
    const open = state(true)
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Dialog, {
        get open() { return open.value },
        title: 'Confirm',
        onClose: reason => reasons.push(reason),
        children: 'Dialog body'
      })
    })
    app.mount(container)

    const root = container.firstElementChild as HTMLElement
    expect(root.hidden).toBe(false)
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Dialog body')
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(reasons).toEqual(['escape'])
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(reasons).toEqual(['escape', 'backdrop'])
    open.value = false
    app.update()
    expect(root.hidden).toBe(true)
    app.destroy()
  })

  it('the built-in Icon is an optional convenience and renders a nameable SVG', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Icon, { name: 'search', size: 20, title: 'Search' })
    })
    app.mount(container)

    const icon = container.querySelector('.vui-icon') as HTMLElement
    expect(icon.dataset.iconName).toBe('search')
    expect(icon.querySelector('svg')).toBeTruthy()
    expect(icon.style.width).toBe('20px')
    expect(icon.getAttribute('aria-label')).toBe('Search')
    expect(icon.getAttribute('aria-hidden')).toBeNull()
    app.destroy()
  })

  it('Icon writes no inline size when size is not passed', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Icon, { name: 'search' })
    })
    app.mount(container)

    const icon = container.querySelector('.vui-icon') as HTMLElement
    expect(icon.hasAttribute('style')).toBe(false)
    app.destroy()
  })
})
