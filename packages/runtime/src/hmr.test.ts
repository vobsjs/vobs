// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { effect, onDispose, scheduler, state } from '@vobs/reactivity'
import {
  createHmrStateStore,
  disposeHmrModule,
  hmrStateRef,
  resolveComponent,
  updateHmrModule
} from './hmr'
import { createComponent, insertBefore, removeChild, setRenderer } from './ops'
import { createFragment, type VobsNode } from './fragment'

function setupRenderer(): void {
  setRenderer<Node, Text, Element, Comment>({
    createText: content => document.createTextNode(content),
    createElement: tag => document.createElement(tag),
    createComment: content => document.createComment(content),
    insertBefore: (parent, child, anchor) => { parent.insertBefore(child, anchor) },
    removeChild: (parent, child) => { parent.removeChild(child) },
    setTextContent: (node, content) => { node.textContent = content },
    setProperty: (node, key, value) => { (node as unknown as Record<string, unknown>)[key] = value },
    setAttribute: (node, key, value) => { node.setAttribute(key, value) },
    addEventListener: (node, event, handler) => { node.addEventListener(event, handler) },
    removeEventListener: (node, event, handler) => { node.removeEventListener(event, handler) },
    nextSibling: node => node.nextSibling,
    clear: container => {
      while (container.childNodes.length > 0) {
        const child = container.childNodes[0]
        if (child) container.removeChild(child)
      }
    }
  })
}

describe('runtime HMR', () => {
  it('刷新已挂载的组件节点时复用原 Owner', () => {
    setupRenderer()
    const moduleId = `hmr-mounted-${Date.now()}-${Math.random()}`
    const first = resolveComponent(() => document.createTextNode('first'), moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)

    updateHmrModule(moduleId, { Panel: () => document.createTextNode('second') })

    expect(parent.textContent).toBe('second')
  })

  it('刷新 fragment 根组件时替换整个 DOM 区间', () => {
    setupRenderer()
    const moduleId = `hmr-fragment-${Date.now()}-${Math.random()}`
    const renderFragment = (label: string): VobsNode => createFragment((parent, anchor) => {
      insertBefore(parent, document.createTextNode(label), anchor)
    })
    const first = resolveComponent(() => renderFragment('first'), moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)
    expect(parent.textContent).toBe('first')

    updateHmrModule(moduleId, { Panel: () => renderFragment('second') })

    expect(parent.textContent).toBe('second')
    // 旧 fragment 区间（start 注释 + 文本 + end 注释）整体移除，只余新区间
    expect(parent.childNodes.length).toBe(3)
  })

  it('普通节点与 fragment 根组件之间互相刷新替换', () => {
    setupRenderer()
    const moduleId = `hmr-mixed-${Date.now()}-${Math.random()}`
    const first = resolveComponent(() => document.createTextNode('first'), moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)

    updateHmrModule(moduleId, {
      Panel: () => createFragment((parent, anchor) => {
        insertBefore(parent, document.createTextNode('second'), anchor)
      })
    })
    expect(parent.textContent).toBe('second')

    updateHmrModule(moduleId, { Panel: () => document.createTextNode('third') })
    expect(parent.textContent).toBe('third')
    expect(parent.childNodes.length).toBe(1)
  })

  it('刷新时释放上一轮渲染作用域：body 清理回调执行、旧 effect 失效', () => {
    setupRenderer()
    const moduleId = `hmr-dispose-${Date.now()}-${Math.random()}`
    const counter = state(0)
    let renderRuns = 0
    let effectRuns = 0
    let disposed = 0
    const first = resolveComponent(() => {
      renderRuns++
      effect(() => {
        void counter.value
        effectRuns++
      })
      onDispose(() => { disposed++ })
      return document.createTextNode('first')
    }, moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)
    expect(renderRuns).toBe(1)

    updateHmrModule(moduleId, {
      Panel: () => {
        renderRuns++
        effect(() => {
          void counter.value
          effectRuns++
        })
        return document.createTextNode('second')
      }
    })

    expect(parent.textContent).toBe('second')
    expect(renderRuns).toBe(2)
    expect(effectRuns).toBe(2)
    expect(disposed).toBe(1)

    // 旧渲染的 effect 已随渲染作用域释放：信号变化只触发新一轮的 effect
    counter.value = 99
    scheduler.flush()
    expect(effectRuns).toBe(3)
  })

  it('一次热更新中每个组件实例只渲染一次（refresh 期间新建的实例不再刷新）', () => {
    setupRenderer()
    const moduleId = `hmr-once-${Date.now()}-${Math.random()}`
    let childRuns = 0
    const child = resolveComponent(() => {
      childRuns++
      return document.createTextNode('child')
    }, moduleId, 'Child')
    const panel = resolveComponent(() => {
      const wrapper = document.createElement('div')
      insertBefore(wrapper, createComponent(child, {}), null)
      return wrapper
    }, moduleId, 'Panel')
    const node = createComponent(panel, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)
    expect(childRuns).toBe(1)

    updateHmrModule(moduleId, {
      Panel: () => createComponent(child, {}),
      Child: () => {
        childRuns++
        return document.createTextNode('child-next')
      }
    })

    // Panel 刷新重渲染 Child 一次；refresh 期间新建的 Child 实例已在快照外，不再刷新
    expect(childRuns).toBe(2)
    expect(parent.textContent).toBe('child-next')
  })

  it('普通卸载仍释放整个渲染作用域', () => {
    setupRenderer()
    const moduleId = `hmr-unmount-${Date.now()}-${Math.random()}`
    let disposed = 0
    const first = resolveComponent(() => {
      onDispose(() => { disposed++ })
      return document.createTextNode('first')
    }, moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)

    removeChild(parent, node)
    expect(disposed).toBe(1)
  })

  it('更新组件代理时保留已有引用，并保留模块状态', () => {
    const moduleId = `hmr-test-${Date.now()}-${Math.random()}`
    const first = resolveComponent(() => ({ textContent: 'first' } as unknown as Node), moduleId, 'Panel')
    const store = createHmrStateStore(moduleId)
    store.set('count', 3)

    updateHmrModule(moduleId, { Panel: () => ({ textContent: 'second' } as unknown as Node) })

    expect(first({})).toHaveProperty('textContent', 'second')
    expect(store.get('count', 0)).toBe(3)
    disposeHmrModule(moduleId)
    expect(createHmrStateStore(moduleId).get('count', 0)).toBe(3)
  })
})

describe('hmrStateRef', () => {
  it('模块重执行时复用既有信号实例（状态保鲜）', () => {
    const create = () => ({ value: 0, tag: Math.random() })
    // 模拟模块首执行
    const firstRef = hmrStateRef('src/stores/a.ts#count', create)
    // 模拟热更新后模块重执行：新实例、同一 key
    const secondRef = hmrStateRef('src/stores/a.ts#count', create)
    expect(secondRef).toBe(firstRef)
    // 不同 key 各自独立
    expect(hmrStateRef('src/stores/a.ts#other', create)).not.toBe(firstRef)
    expect(hmrStateRef('src/stores/b.ts#count', create)).not.toBe(firstRef)
  })
})
