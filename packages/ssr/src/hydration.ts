import { describeDebugNode, invokeRuntimeDebug, type VobsRenderer } from '@vobs/runtime'

export interface HydrationRenderer {
  readonly renderer: VobsRenderer<Node, Text, Element, Comment>
}

export function createHydrationRenderer(container: Element): HydrationRenderer {
  const claimed = new WeakMap<Node, Set<ChildNode>>()
  let currentParent: Node = container
  let hydrating = false

  function claim<T extends ChildNode>(
    predicate: (node: ChildNode) => node is T,
    expected: string
  ): T {
    const nodes = currentParent.childNodes
    const seen = claimed.get(currentParent) ?? new Set<ChildNode>()
    claimed.set(currentParent, seen)

    for (const node of nodes) {
      if (!seen.has(node) && predicate(node)) {
        seen.add(node)
        return node
      }
    }

    const actual = [...nodes]
      .find(node => !seen.has(node))
    throwHydrationMismatch(
      actual?.nodeType === 3 && expected.startsWith('文本节点') ? 'content' : 'missing-node',
      expected,
      actual ? describeHydrationNode(actual) : '<none>',
      currentParent
    )
  }

  function assertAllNodesClaimed(parent: Node): void {
    const seen = claimed.get(parent)
    for (const child of parent.childNodes) {
      if (!seen?.has(child)) {
        throwHydrationMismatch('extra-node', '<claimed node>', describeHydrationNode(child), parent)
      }
      assertAllNodesClaimed(child)
    }
  }

  const renderer: VobsRenderer<Node, Text, Element, Comment> = {
    createText(content: string): Text {
      return claim(
        (node): node is Text => node instanceof Text
          && (content.length === 0 || node.data === content),
        content.length === 0 ? '动态文本节点' : `文本节点 "${content}"`
      )
    },

    createElement(tag: string): Element {
      const element = claim(
        (node): node is Element => node instanceof Element
          && node.tagName.toLowerCase() === tag.toLowerCase(),
        `<${tag}>`
      )
      currentParent = element
      return element
    },

    createComment(content: string): Comment {
      return claim(
        (node): node is Comment => node instanceof Comment && node.data === content,
        `注释 "${content}"`
      )
    },

    insertBefore(parent: Node, child: Node, anchor: Node | null): void {
      if (hydrating) {
        if (child.parentNode !== parent || (anchor && anchor.parentNode !== parent)) {
          throwHydrationMismatch('position', describeHydrationNode(parent), describeHydrationNode(child), parent)
        }
        currentParent = parent
        return
      }
      parent.insertBefore(child, anchor)
    },

    removeChild(parent: Node, child: Node): void {
      parent.removeChild(child)
    },

    setTextContent(node: Text, content: string): void {
      node.textContent = content
    },

    setProperty(node: Element, key: string, value: unknown): void {
      Reflect.set(node, key, value)
    },

    setAttribute(node: Element, key: string, value: string): void {
      node.setAttribute(key, value)
    },

    addEventListener(node: Element, event: string, handler: EventListener): void {
      node.addEventListener(event, handler)
    },

    removeEventListener(node: Element, event: string, handler: EventListener): void {
      node.removeEventListener(event, handler)
    },

    nextSibling(node: Node): Node | null {
      return node.nextSibling
    },

    clear(node: Node): void {
      node.textContent = ''
    },

    beginHydration(): void {
      hydrating = true
      currentParent = container
    },

    completeHydration(): void {
      assertAllNodesClaimed(container)
      hydrating = false
    }
  }

  return { renderer }
}

function throwHydrationMismatch(
  kind: 'missing-node' | 'extra-node' | 'position' | 'content',
  expected: string,
  actual: string,
  parent: Node
): never {
  const path = describeHydrationPath(parent)
  const message = kind === 'extra-node'
    ? 'Vobs hydration: 服务端 DOM 包含客户端未声明的节点'
    : kind === 'position'
      ? 'Vobs hydration: 节点位置与客户端渲染结果不一致'
      : `Vobs hydration: 未找到匹配的 ${expected}`
  const details = { kind, expected, actual, path, message } as const
  const error = Object.assign(new Error(message), {
    name: 'HydrationMismatchError',
    vobsCode: 'VOBS_HYDRATION_MISMATCH',
    vobsHydration: details
  })
  invokeRuntimeDebug('hydrationMismatch', details)
  throw error
}

function describeHydrationNode(node: Node): string {
  if (node.nodeType === 3) return `#text(${JSON.stringify(node.textContent ?? '')})`
  if (node.nodeType === 8) return `<!--${node.textContent ?? ''}-->`
  return describeDebugNode(node)
}

function describeHydrationPath(node: Node): string {
  const segments: string[] = []
  let current: Node | null = node
  while (current && current.nodeType === 1) {
    const element = current as Element
    let index = 1
    let sibling = element.previousElementSibling
    while (sibling) {
      index++
      sibling = sibling.previousElementSibling
    }
    segments.unshift(`${element.tagName.toLowerCase()}:nth-child(${index})`)
    current = element.parentElement
  }
  return segments.length > 0 ? `/${segments.join('/')}` : '<container>'
}
