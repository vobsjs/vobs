import {
  createVobs,
  type VobsApp,
  type VobsConfig,
  type VobsPlugin
} from '@vobs/vobs'
import { batch, scheduler } from '@vobs/reactivity'
import type { VobsRenderer } from '@vobs/runtime'

export type TestNode = TestElement | TestText | TestComment

export interface TestElement {
  type: 'element'
  tag: string
  attrs: Record<string, string>
  props: Record<string, unknown>
  events: Record<string, EventListener>
  children: TestNode[]
  parent: TestElement | null
}

export interface TestText {
  type: 'text'
  content: string
  parent: TestElement | null
}

export interface TestComment {
  type: 'comment'
  content: string
  parent: TestElement | null
}

export interface TestRenderer {
  readonly container: TestElement
  readonly renderer: VobsRenderer<TestNode, TestText, TestElement, TestComment>
  queryByText(text: string): TestNode | null
  queryByTag(tag: string): TestElement | null
  queryByAttr(name: string, value: string): TestElement | null
}

export interface MountedTestApp {
  readonly app: VobsApp<TestNode>
  readonly container: TestElement
  update(): void
  destroy(): void
  queryByText(text: string): TestNode | null
  queryByTag(tag: string): TestElement | null
  queryByAttr(name: string, value: string): TestElement | null
  fireEvent(event: string, options: { target: string }): void
}

/** Execute test updates as one deterministic reactive transaction. */
export function act<T>(fn: () => T): T {
  return batch(fn)
}

/** Flush queued effects without relying on implementation-specific timers. */
export function flushEffects(): void {
  scheduler.flush()
}

/** Resolve pending Promise continuations and then flush reactive effects. */
export async function flushPromises(): Promise<void> {
  await Promise.resolve()
  scheduler.flush()
}

export interface PerformanceMeasurement<T = unknown> {
  readonly label: string
  readonly duration: number
  readonly result: T
}

/** Small deterministic measurement helper for component/runtime baselines. */
export function measure<T>(label: string, fn: () => T): PerformanceMeasurement<T> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const result = fn()
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return { label, duration: Math.max(0, ended - started), result }
}

export function createTestRenderer(): TestRenderer {
  const container = createElementNode('root')
  const renderer: VobsRenderer<TestNode, TestText, TestElement, TestComment> = {
    createText(content: string): TestText {
      return { type: 'text', content, parent: null }
    },

    createElement(tag: string): TestElement {
      return createElementNode(tag)
    },

    createComment(content: string): TestComment {
      return { type: 'comment', content, parent: null }
    },

    insertBefore(parent: TestElement, child: TestNode, anchor: TestNode | null): void {
      if (child.parent) removeChildNode(child.parent, child)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index >= 0) parent.children.splice(index, 0, child)
      else parent.children.push(child)
      child.parent = parent
    },

    removeChild(parent: TestElement, child: TestNode): void {
      removeChildNode(parent, child)
    },

    setTextContent(node: TestText, content: string): void {
      node.content = content
    },

    setProperty(node: TestElement, key: string, value: unknown): void {
      node.props[key] = value
    },

    setAttribute(node: TestElement, key: string, value: string): void {
      node.attrs[key] = value
    },

    addEventListener(node: TestElement, event: string, handler: EventListener): void {
      node.events[event] = handler
    },

    removeEventListener(node: TestElement, event: string, handler: EventListener): void {
      if (node.events[event] === handler) delete node.events[event]
    },

    nextSibling(node: TestNode): TestNode | null {
      const parent = node.parent
      if (!parent) return null
      const index = parent.children.indexOf(node)
      return index >= 0 ? parent.children[index + 1] ?? null : null
    },

    clear(node: TestElement): void {
      for (const child of node.children) child.parent = null
      node.children.length = 0
    }
  }

  return {
    container,
    renderer,
    queryByText: text => findNode(container, node => node.type === 'text' && node.content === text),
    queryByTag: tag => findNode(container, node => node.type === 'element' && node.tag === tag) as TestElement | null,
    queryByAttr: (name, value) => findNode(
      container,
      node => node.type === 'element' && node.attrs[name] === value
    ) as TestElement | null
  }
}

export function mount(
  render: VobsConfig['render'],
  options: { plugins?: VobsPlugin[] } = {}
): MountedTestApp {
  const testRenderer = createTestRenderer()
  const app = createVobs({
    render,
    renderer: testRenderer.renderer,
    plugins: options.plugins
  })
  app.mount(testRenderer.container)

  return {
    app,
    container: testRenderer.container,
    update: () => app.update(),
    destroy: () => app.destroy(),
    queryByText: testRenderer.queryByText,
    queryByTag: testRenderer.queryByTag,
    queryByAttr: testRenderer.queryByAttr,
    fireEvent(event, { target }): void {
      const node = testRenderer.queryByTag(target)
      const handler = node?.events[event]
      if (!handler) throw new Error(`Vobs test-utils: 未找到 ${target} 的 ${event} 事件处理器`)
      handler.call(node, { type: event, target: node } as unknown as Event)
    }
  }
}

function createElementNode(tag: string): TestElement {
  return {
    type: 'element',
    tag,
    attrs: {},
    props: {},
    events: {},
    children: [],
    parent: null
  }
}

function removeChildNode(parent: TestElement, child: TestNode): void {
  const index = parent.children.indexOf(child)
  if (index < 0) throw new Error('Vobs test-utils: 节点不属于指定父节点')
  parent.children.splice(index, 1)
  child.parent = null
}

function findNode(root: TestElement, predicate: (node: TestNode) => boolean): TestNode | null {
  for (const child of root.children) {
    if (predicate(child)) return child
    if (child.type === 'element') {
      const result = findNode(child, predicate)
      if (result) return result
    }
  }
  return null
}
