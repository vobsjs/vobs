import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onDispose, state } from '@vobs/reactivity'
import { createComponent, createElement, createText, createVobs, insertBefore, setRenderer } from '@vobs/vobs'
import { createDOMRenderer } from '@vobs/dom'
import { renderToString } from '@vobs/ssr'
import { Transition, TransitionGroup } from './transition'
import type { TransitionGroupProps } from './types'

describe('@vobs/transition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>))
    setRenderer(createDOMRenderer())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('在节点插入后执行 enter class 生命周期并清理 class', () => {
    const stages: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Transition, {
        name: 'fade',
        duration: 0,
        appear: true,
        onBeforeEnter: () => stages.push('before-enter'),
        onEnter: () => stages.push('enter'),
        onAfterEnter: () => stages.push('after-enter'),
        children: () => textNode('visible')
      })
    })
    app.mount(container)

    const node = container.querySelector('span')!
    expect(node.classList.contains('fade-enter-from')).toBe(true)
    expect(node.classList.contains('fade-enter-active')).toBe(true)
    expect(stages).toEqual(['before-enter', 'enter'])

    vi.advanceTimersByTime(16)
    expect(node.className).toBe('')
    expect(stages).toEqual(['before-enter', 'enter', 'after-enter'])
    app.destroy()
  })

  it('使用 from/to 样式，并在 transitionend 后恢复原始 inline style', () => {
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Transition, {
        appear: true,
        name: 'slide',
        enter: {
          duration: 120,
          easing: 'ease-out',
          from: { opacity: 0, transform: 'translateY(-4px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        },
        children: () => textNode('visible')
      })
    })
    app.mount(container)

    const node = container.querySelector('span')!
    expect(node.classList.contains('slide-enter-from')).toBe(true)
    expect(node.style.opacity).toBe('0')
    expect(node.style.transform).toBe('translateY(-4px)')

    vi.advanceTimersByTime(16)
    expect(node.classList.contains('slide-enter-to')).toBe(true)
    expect(node.style.opacity).toBe('1')
    expect(node.style.transitionDuration).toBe('120ms')
    node.dispatchEvent(new Event('transitionend'))

    expect(node.className).toBe('')
    expect(node.style.opacity).toBe('')
    expect(node.style.transform).toBe('')
    expect(node.style.transitionDuration).toBe('')
    app.destroy()
  })

  it('leave 完成前保留节点与 Owner，完成后才移除', () => {
    const shown = state(true)
    const stages: string[] = []
    const disposals: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Transition, {
        get show() { return shown.value },
        name: 'fade',
        duration: 120,
        onBeforeLeave: () => stages.push('before-leave'),
        onAfterLeave: () => stages.push('after-leave'),
        children: () => createComponent(DisposableContent, { onDispose: () => disposals.push('disposed') })
      })
    })
    app.mount(container)
    vi.advanceTimersByTime(16)

    shown.value = false
    app.update()
    const node = container.querySelector('span')!
    expect(node.classList.contains('fade-leave-from')).toBe(true)
    expect(container.querySelector('span')).toBe(node)
    expect(disposals).toEqual([])

    vi.advanceTimersByTime(16)
    expect(node.classList.contains('fade-leave-to')).toBe(true)
    node.dispatchEvent(new Event('transitionend'))

    expect(container.querySelector('span')).toBeNull()
    expect(stages).toEqual(['before-leave', 'after-leave'])
    expect(disposals).toEqual(['disposed'])
    app.destroy()
  })

  it('遵循 prefers-reduced-motion 并立即完成 enter 和 leave', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const shown = state(true)
    const stages: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Transition, {
        get show() { return shown.value },
        appear: true,
        name: 'fade',
        duration: 120,
        onAfterEnter: () => stages.push('after-enter'),
        onAfterLeave: () => stages.push('after-leave'),
        children: () => textNode('visible')
      })
    })
    app.mount(container)

    const node = container.querySelector('span')!
    expect(node.className).toBe('')
    expect(stages).toEqual(['after-enter'])

    shown.value = false
    app.update()
    expect(container.querySelector('span')).toBeNull()
    expect(stages).toEqual(['after-enter', 'after-leave'])
    app.destroy()
  })

  it('show 在 leave 期间恢复时取消离开并保持同一节点', () => {
    const shown = state(true)
    const events: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(Transition, {
        get show() { return shown.value },
        name: 'fade',
        duration: 120,
        onLeaveCancelled: () => events.push('leave-cancelled'),
        children: () => textNode('visible')
      })
    })
    app.mount(container)
    vi.advanceTimersByTime(16)
    const node = container.querySelector('span')!

    shown.value = false
    app.update()
    shown.value = true
    app.update()

    expect(container.querySelector('span')).toBe(node)
    expect(events).toEqual(['leave-cancelled'])
    expect(node.classList.contains('fade-leave-from')).toBe(false)
    vi.advanceTimersByTime(16)
    app.destroy()
  })

  it('TransitionGroup 以 key 追踪条目并在 leave 后删除', () => {
    const people = state([
      { id: 'ada', name: 'Ada' },
      { id: 'lin', name: 'Lin' }
    ])
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const list = createElement('ul')
        insertBefore(list, createComponent(People, {
          get items() { return people.value },
          keyOf: person => person.id,
          renderItem: person => textNode(person.name),
          duration: 0
        }), null)
        return list
      }
    })
    app.mount(container)
    vi.advanceTimersByTime(16)
    expect(container.querySelectorAll('span')).toHaveLength(2)

    people.value = [{ id: 'lin', name: 'Lin' }]
    app.update()
    expect(container.querySelectorAll('span')).toHaveLength(2)
    vi.advanceTimersByTime(16)
    expect([...container.querySelectorAll('span')].map(node => node.textContent)).toEqual(['Lin'])
    app.destroy()
  })

  it('重复 key 在列表提交前报错并保留上一轮 DOM', () => {
    const people = state([
      { id: 'ada', name: 'Ada' },
      { id: 'lin', name: 'Lin' }
    ])
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(People, {
        get items() { return people.value },
        keyOf: person => person.id,
        renderItem: person => textNode(person.name),
        duration: 0
      })
    })
    app.mount(container)

    people.value = [
      { id: 'ada', name: 'Ada 2' },
      { id: 'ada', name: 'Ada 3' }
    ]
    expect(() => app.update()).toThrow('重复 key')
    expect([...container.querySelectorAll('span')].map(node => node.textContent)).toEqual(['Ada', 'Lin'])
    app.destroy()
  })

  it('renderItem 使用 index 时在重排后刷新索引', () => {
    const people = state([
      { id: 'ada', name: 'Ada' },
      { id: 'lin', name: 'Lin' }
    ])
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(People, {
        get items() { return people.value },
        keyOf: person => person.id,
        renderItem: (person, index) => textNode(`${person.name}:${index}`),
        duration: 0
      })
    })
    app.mount(container)

    people.value = [...people.value].reverse()
    app.update()
    expect([...container.querySelectorAll('span')].map(node => node.textContent)).toEqual(['Lin:0', 'Ada:1'])
    app.destroy()
  })

  it('SSR 不访问 DOM，并直接输出当前可见分支', () => {
    const visible = renderToString(() => createComponent(Transition, {
      show: true,
      name: 'fade',
      children: () => textNode('server content')
    }))
    const hidden = renderToString(() => createComponent(Transition, {
      show: false,
      children: () => textNode('hidden content')
    }))

    expect(visible).toContain('server content')
    expect(visible).not.toContain('fade-enter')
    expect(hidden).not.toContain('hidden content')
  })

  it('children 数组入口可以保持稳定节点并执行 leave', () => {
    const first = textNode('first')
    const second = textNode('second')
    const children = state<readonly Element[]>([first, second])
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(TransitionGroup, {
        get children() { return children.value },
        duration: 0
      })
    })
    app.mount(container)
    expect(container.querySelectorAll('span')).toHaveLength(2)

    children.value = [second]
    app.update()
    expect(container.querySelectorAll('span')).toHaveLength(2)
    vi.advanceTimersByTime(16)
    expect([...container.querySelectorAll('span')].map(node => node.textContent)).toEqual(['second'])
    app.destroy()
  })
})

function textNode(value: string): Element {
  const node = createElement('span')
  insertBefore(node, createText(value), null)
  return node
}

function DisposableContent(props: { readonly onDispose: () => void }): Element {
  onDispose(props.onDispose)
  return textNode('visible')
}

function People(props: TransitionGroupProps<{ id: string, name: string }>) {
  return TransitionGroup(props)
}
