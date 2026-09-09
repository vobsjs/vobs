// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  createHmrStateStore,
  disposeHmrModule,
  resolveComponent,
  updateHmrModule
} from './hmr'
import { createComponent, insertBefore, setRenderer } from './ops'

describe('runtime HMR', () => {
  it('刷新已挂载的组件节点时复用原 Owner', () => {
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
    const moduleId = `hmr-mounted-${Date.now()}-${Math.random()}`
    const first = resolveComponent(() => document.createTextNode('first'), moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)

    updateHmrModule(moduleId, { Panel: () => document.createTextNode('second') })

    expect(parent.textContent).toBe('second')
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
