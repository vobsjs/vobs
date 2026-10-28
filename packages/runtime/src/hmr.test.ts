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
  it('reuses the original Owner when refreshing a mounted component node', () => {
    setupRenderer()
    const moduleId = `hmr-mounted-${Date.now()}-${Math.random()}`
    const first = resolveComponent(() => document.createTextNode('first'), moduleId, 'Panel')
    const node = createComponent(first, {})
    const parent = document.createElement('div')
    insertBefore(parent, node, null)

    updateHmrModule(moduleId, { Panel: () => document.createTextNode('second') })

    expect(parent.textContent).toBe('second')
  })

  it('replaces the whole DOM range when refreshing a fragment-rooted component', () => {
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
    // The old fragment range (start comment + text + end comment) is removed wholesale, leaving only the new range
    expect(parent.childNodes.length).toBe(3)
  })

  it('refreshes back and forth between plain-node and fragment root components', () => {
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

  it('releasing the previous render scope on refresh: body cleanup callbacks run, old effects invalidated', () => {
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

    // The old render's effect was released with the render scope: signal changes only trigger the new round's effect
    counter.value = 99
    scheduler.flush()
    expect(effectRuns).toBe(3)
  })

  it('each component instance renders only once per hot update (instances created during refresh are not refreshed again)', () => {
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

    // Panel's refresh re-renders Child once; Child instances created during refresh are
    // already outside the snapshot and are not refreshed again
    expect(childRuns).toBe(2)
    expect(parent.textContent).toBe('child-next')
  })

  it('normal unmount still releases the entire render scope', () => {
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

  it('keeps existing references when updating the component proxy, and preserves module state', () => {
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
  it('reuses the existing signal instance when the module re-executes (state stays fresh)', () => {
    const create = () => ({ value: 0, tag: Math.random() })
    // Simulate the module's first execution
    const firstRef = hmrStateRef('src/stores/a.ts#count', create)
    // Simulate module re-execution after a hot update: new instance, same key
    const secondRef = hmrStateRef('src/stores/a.ts#count', create)
    expect(secondRef).toBe(firstRef)
    // Different keys are independent
    expect(hmrStateRef('src/stores/a.ts#other', create)).not.toBe(firstRef)
    expect(hmrStateRef('src/stores/b.ts#count', create)).not.toBe(firstRef)
  })
})
