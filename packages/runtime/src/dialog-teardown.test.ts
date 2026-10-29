// @vitest-environment jsdom
// Regression tests (from the Labelune dialog pitfalls, docs/todo.md memo):
// ① Dialog conditional children → null coexists with sibling content (semantic guarantee
//    for the application-level "separate switch from data" pattern)
// ② User-land components pass children through and render them as nodes (compiled-output
//    shape simulation; the compiler side has its own output assertions)
// ③ When insertDynamic unmounts a subtree, its old effects are cleaned up too (ghost
//    subscription detection)
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, createComponent, insertBefore, insertDynamic, insertDynamicValue } from '@vobs/vobs'
import { effect, state } from '@vobs/reactivity'

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('Dialog conditional children coexist with sibling content', () => {
  // Simulate the Labelune TemplatesPage structure: the page has content first, the Dialog
  // (children conditionally rendered) is appended at the end
  it('sibling content remains after closing the dialog (open and children share one signal)', async () => {
    setRenderer(createDOMRenderer())
    const request = state<{ message: string } | null>(null)

    // Simulate compiled output: children getter + open getter both read the same signal
    function buildBody(): HTMLElement {
      const div = document.createElement('div')
      div.className = 'template-dialog'
      div.textContent = 'dialog-body'
      return div
    }

    // @vobs/ui Dialog core structure: backdrop(root) > surface > (head) + body(mountSlot → insertDynamic)
    const root = document.createElement('div')
    root.setAttribute('role', 'presentation')

    const surface = document.createElement('section')
    surface.setAttribute('role', 'dialog')
    const body = document.createElement('div')
    surface.appendChild(body)
    root.appendChild(surface)

    // The Dialog's open effect (simulating dialog.ts lines 70-79)
    effect(() => {
      const open = request.value !== null
      ;(root as HTMLElement & { hidden: boolean }).hidden = !open
    })

    // mountSlot: the children slot
    insertDynamic(body, null, () => {
      const value = request.value !== null ? buildBody() : null
      return value
    })

    // Page structure: the panel precedes the Dialog (a same-level sibling)
    const page = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'templates-grid'
    panel.textContent = 'template-card-content'
    page.appendChild(panel)
    page.appendChild(root)

    // Open the dialog: open and children both true
    request.set({ message: 'Delete template?' })
    await flush()
    expect(body.querySelector('.template-dialog')).not.toBeNull()
    expect(page.querySelector('.templates-grid')).not.toBeNull()

    // Close the dialog: open and children both become null (the application's original form)
    request.set(null)
    await flush()
    expect(body.querySelector('.template-dialog')).toBeNull()
    // Key assertion: sibling content doesn't disappear
    expect(page.querySelector('.templates-grid')).not.toBeNull()
    expect(page.textContent).toContain('template-card-content')
  })
})

describe('user-land components pass children through', () => {
  // Simulate compiled output: function Section({children}) { return <section>{children}</section> }
  // children compiles to a getter (get accessor) on props, evaluated on read
  it('node children render as nodes, not [object HTMLDivElement]', async () => {
    setRenderer(createDOMRenderer())
    function Section(props: { readonly children?: unknown }): Node {
      const section = document.createElement('section')
      // children is a node at runtime; the unknown type must be narrowed to a
      // DynamicChild-acceptable form
      insertDynamicValue(section, null, () => Reflect.get(props, 'children') as never)
      return section
    }
    // Caller's compiled output: the children getter returns the built node (the
    // transformElement IIFE evaluation result)
    const node = createComponent(Section, {
      get children() {
        const div = document.createElement('div')
        div.textContent = 'inner'
        return div
      }
    })
    const host = document.createElement('div')
    insertBefore(host, node, null)
    expect(host.textContent).toBe('inner')
    expect(host.textContent).not.toContain('[object')
  })

  it('array children are expanded and rendered', () => {
    setRenderer(createDOMRenderer())
    function Section(props: { readonly children?: unknown }): Node {
      const section = document.createElement('section')
      // children is a node/node array at runtime; the unknown type must be narrowed to a
      // DynamicChild-acceptable form
      insertDynamicValue(section, null, () => Reflect.get(props, 'children') as never)
      return section
    }
    const node = createComponent(Section, {
      get children() {
        const a = document.createElement('span')
        a.textContent = 'a'
        const b = document.createElement('span')
        b.textContent = 'b'
        return [a, b]
      }
    })
    const host = document.createElement('div')
    insertBefore(host, node, null)
    expect(host.textContent).toBe('ab')
  })
})

describe('effect cleanup when insertDynamic unmounts a subtree', () => {
  it('old component effects are cleaned up after the condition flips to null (ghost subscription detection)', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(true)
    const unrelated = state(0)
    let cleanups = 0
    function Inner(): Node {
      effect(() => {
        unrelated.value // the component body reads a signal
        return () => {
          cleanups += 1
        }
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Inner, {}) : null))
    await flush()
    expect(parent.querySelector('span')).not.toBeNull()

    visible.set(false)
    await flush()
    expect(parent.querySelector('span')).toBeNull()
    // Key assertion: the old effect was cleaned up and no longer subscribes to unrelated
    expect(cleanups).toBe(1)

    unrelated.set(99)
    await flush()
    expect(cleanups).toBe(1)
  })

  it('nested component owners are cleaned up together with the subtree unmount', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(true)
    const unrelated = state(0)
    const cleanups: string[] = []
    function Outer(): Node {
      effect(() => {
        unrelated.value
        return () => cleanups.push('outer')
      })
      const wrap = document.createElement('div')
      insertBefore(wrap, createComponent(Inner, {}), null)
      return wrap
    }
    function Inner(): Node {
      effect(() => {
        unrelated.value
        return () => cleanups.push('inner')
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Outer, {}) : null))
    await flush()

    visible.set(false)
    await flush()
    expect(cleanups).toContain('outer')
    expect(cleanups).toContain('inner')

    unrelated.set(1)
    await flush()
    expect(cleanups.filter(entry => entry === 'outer')).toHaveLength(1)
    expect(cleanups.filter(entry => entry === 'inner')).toHaveLength(1)
  })
})
