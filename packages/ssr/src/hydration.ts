import { describeDebugNode, invokeRuntimeDebug, type VobsRenderer } from '@vobs/runtime'

export interface HydrationRenderer {
  readonly renderer: VobsRenderer<Node, Text, Element, Comment>
}

export function createHydrationRenderer(container: Element): HydrationRenderer {
  const claimed = new WeakMap<Node, Set<ChildNode>>()
  let currentParent: Node = container
  let hydrating = false

  /**
   * SSR 序列化在相邻文本节点间插入的边界注释（见 renderer.ts serializeChildren）。
   * 它只为阻止 HTML 解析器合并文本节点，不参与客户端声明，认领与完整性校验均视为透明。
   */
  function isSeparatorComment(node: ChildNode): boolean {
    return node instanceof Comment && node.data === ' '
  }

  // 水合会话内全部已认领节点（认领顺序）：回退层的候选若落在任何已认领节点的
  // 子树内即为"服务端多余节点"，必须跳过（见 tryClaim 回退层规则）。
  const claimedNodes: ChildNode[] = []

  function tryClaim<T extends ChildNode>(
    predicate: (node: ChildNode) => node is T
  ): T | null {
    // 先在当前父认领；失败时沿祖先链回退到水合容器——"先连续创建兄弟、后统一插入"
    // 的产物模式（数组 map 经 insertDynamicValue/insertList）会在创建游标仍停留在
    // 上一个元素内部时认领下一个兄弟，回退扫描让这类合法产物按文档序正确认领。
    let parent: Node | null = currentParent
    while (parent) {
      // 回退层（跨出起始游标所在层级）的候选若落在任何已认领节点的子树内，
      // 即为服务端多余节点，跳过（由 assertAllNodesClaimed 精确报 extra-node）。
      const isFallback = parent !== currentParent
      const seen = claimed.get(parent) ?? new Set<ChildNode>()
      claimed.set(parent, seen)
      for (const node of parent.childNodes) {
        if (seen.has(node) || isSeparatorComment(node)) continue
        if (isFallback && claimedNodes.some(claimed => claimed.contains(node))) continue
        if (predicate(node)) {
          seen.add(node)
          claimedNodes.push(node)
          return node
        }
      }
      if (parent === container) break
      parent = parent.parentNode
    }
    return null
  }

  function claim<T extends ChildNode>(
    predicate: (node: ChildNode) => node is T,
    expected: string
  ): T {
    const node = tryClaim(predicate)
    if (node) return node

    const actual = [...container.querySelectorAll('*')]
      .find(node => !isSeparatorComment(node) && !isClaimed(node))
    throwHydrationMismatch(
      actual?.nodeType === 3 && expected.startsWith('文本节点') ? 'content' : 'missing-node',
      expected,
      actual ? describeHydrationNode(actual) : '<none>',
      currentParent
    )
  }

  function isClaimed(node: ChildNode): boolean {
    let parent: Node | null = node.parentNode
    while (parent) {
      if (claimed.get(parent)?.has(node)) return true
      parent = parent.parentNode
    }
    return false
  }

  function assertAllNodesClaimed(parent: Node): void {
    const seen = claimed.get(parent)
    for (const child of parent.childNodes) {
      if (isSeparatorComment(child)) continue
      if (!seen?.has(child)) {
        throwHydrationMismatch('extra-node', '<claimed node>', describeHydrationNode(child), parent)
      }
      assertAllNodesClaimed(child)
    }
  }

  const renderer: VobsRenderer<Node, Text, Element, Comment> = {
    createText(content: string): Text {
      // 水合完成后退化为真实 DOM 创建：后续的动态重渲染（状态切换重建分支等）
      // 需要创建全新节点，不能再走认领（服务端 DOM 早已全部认领完毕）。
      if (!hydrating) return document.createTextNode(content)
      // 空动态文本：SSR 输出空注释占位（<!---->，HTML 无法表示空文本节点）。
      // 1) 服务端渲染值为空 → 占位存在：认领占位注释并原地替换为真实文本节点，
      //    位置精确，不会误抢后续兄弟文本；
      // 2) 服务端渲染值非空 → 占位不存在、DOM 中是真实文本：认领任意未认领文本
      //    （绑定 effect 随后覆写为真实值）。
      if (content === '') {
        const marker = tryClaim(
          (node): node is Comment => node instanceof Comment && node.data === '',
        )
        if (marker) {
          const parent = marker.parentNode!
          const textNode = document.createTextNode('')
          parent.replaceChild(textNode, marker)
          claimedNodes.push(textNode)
          const seen = claimed.get(parent)
          seen?.add(textNode)
          return textNode
        }
      }
      return claim(
        (node): node is Text => node instanceof Text
          && (content === '' || node.data === content),
        content === '' ? '动态文本节点' : `文本节点 "${content}"`
      )
    },

    createElement(tag: string): Element {
      if (!hydrating) return document.createElement(tag)
      const element = claim(
        (node): node is Element => node instanceof Element
          && node.tagName.toLowerCase() === tag.toLowerCase(),
        `<${tag}>`
      )
      currentParent = element
      return element
    },

    createComment(content: string): Comment {
      if (!hydrating) return document.createComment(content)
      return claim(
        (node): node is Comment => node instanceof Comment && node.data === content,
        `注释 "${content}"`
      )
    },

    insertBefore(parent: Node, child: Node, anchor: Node | null): void {
      if (hydrating) {
        // 水合期间新创建的节点（空动态文本等）：服务端 DOM 无对应节点，直接真实
        // 插入到动态槽位锚点前，并计入认领状态。
        if (child.parentNode === null) {
          const inserted = child as ChildNode
          parent.insertBefore(inserted, anchor)
          const seen = claimed.get(parent) ?? new Set<ChildNode>()
          claimed.set(parent, seen)
          seen.add(inserted)
          claimedNodes.push(inserted)
          currentParent = parent
          return
        }
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
  // message 自包含关键诊断（浏览器控制台看不到 vobsHydration 附件），便于直接定位水合差异。
  const error = Object.assign(new Error(`${message} [${kind}] expected=${expected} actual=${actual} path=${path}`), {
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
