import { describeDebugNode, invokeRuntimeDebug, type VobsRenderer } from '@vobs/runtime'

export interface HydrationRenderer {
  readonly renderer: VobsRenderer<Node, Text, Element, Comment>
}

export interface HydrationRendererOptions {
  /**
   * 严格模式。服务端渲染了**非空文本**、而客户端此刻要空文本节点时（只能临时认领、等绑定 effect 覆写），
   * 默认行为是"照旧认领 + 发一条 `hydrationProvisionalText` 事件"；打开此项则**直接报水合不匹配**
   * （`kind: 'content'`）—— 用于把"值被悄悄换掉"从可观测升级为可拒绝。
   */
  readonly strictTextContent?: boolean
}

export function createHydrationRenderer(
  container: Element,
  options: HydrationRendererOptions = {}
): HydrationRenderer {
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

  function tryClaim<T extends ChildNode>(
    predicate: (node: ChildNode) => node is T
  ): T | null {
    // 先在当前父认领；失败时沿祖先链回退到水合容器——"先连续创建兄弟、后统一插入"
    // 的产物模式（数组 map 经 insertDynamicValue/insertList）会在创建游标仍停留在
    // 上一个元素内部时认领下一个兄弟，回退扫描让这类合法产物按文档序正确认领。
    // 只扫各层直接孩子：服务端多余节点不会在此被误认领，由
    // assertAllNodesClaimed 在水合结束时精确报 extra-node。
    let parent: Node | null = currentParent
    while (parent) {
      const seen = claimed.get(parent) ?? new Set<ChildNode>()
      claimed.set(parent, seen)
      for (const node of parent.childNodes) {
        if (seen.has(node) || isSeparatorComment(node)) continue
        if (predicate(node)) {
          seen.add(node)
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

    /*
     * 诊断用的 actual。原来只扫 `querySelectorAll('*')`（**只有元素**），于是
     * `actual?.nodeType === 3` 永远不成立、`kind: 'content'` 是**不可达分支** ——
     * "期望文本、DOM 里却是别的文本"这种最典型的水合差异只会报 missing-node 且 actual=<none>。
     * 这里在找不到未认领元素时继续找未认领的**文本节点**，让 content 分支真正可达。
     */
    const actual = [...container.querySelectorAll('*')]
      .find(node => !isSeparatorComment(node) && !isClaimed(node))
      ?? firstUnclaimedText()
    throwHydrationMismatch(
      actual?.nodeType === 3 && expected.startsWith('文本节点') ? 'content' : 'missing-node',
      expected,
      actual ? describeHydrationNode(actual) : '<none>',
      currentParent
    )
  }

  /** 按文档序找第一个未被认领的文本节点（给上面的诊断用）。 */
  function firstUnclaimedText(): Text | null {
    const walk = (parent: Node): Text | null => {
      for (let index = 0; index < parent.childNodes.length; index++) {
        const child = parent.childNodes[index]
        if (child.nodeType === 3) {
          if (!isClaimed(child)) return child as Text
          continue
        }
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(container)
  }

  function isClaimed(node: ChildNode): boolean {
    let parent: Node | null = node.parentNode
    while (parent) {
      if (claimed.get(parent)?.has(node)) return true
      parent = parent.parentNode
    }
    return false
  }

  /**
   * 认领服务端已渲染的文本节点来承载 `setProperty(node, 'textContent'|'innerText', value)`。
   *
   * 只认领满足下面两条的节点，避免"抢错节点"：
   * 1. 尚未被认领（防止把别的绑定要用的文本节点抢走）；
   * 2. 服务端文本与客户端值**逐字相同** —— 不同就说明服务端渲染的是别的内容，
   *    那样应当退回直接赋值、让 `assertAllNodesClaimed` 如实报出差异，而不是掩盖它。
   *
   * 返回 true 表示已经用认同的节点处理完，调用方不必再 Reflect.set。
   */
  function claimTextContent(node: Element, value: unknown): boolean {
    if (typeof value !== 'string') return false
    for (let index = 0; index < node.childNodes.length; index++) {
      const child = node.childNodes[index]
      if (child.nodeType !== 3 || isClaimed(child as ChildNode)) continue
      if (child.nodeValue !== value) continue
      const seen = claimed.get(node) ?? new Set<ChildNode>()
      claimed.set(node, seen)
      seen.add(child as ChildNode)
      return true
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

  /** 把整棵子树记为已认领（innerHTML 换出来的节点无法逐个与服务端产物比对）。 */
  function markSubtreeClaimed(parent: Node): void {
    const stack: Node[] = []
    for (let index = 0; index < parent.childNodes.length; index++) stack.push(parent.childNodes[index])
    while (stack.length > 0) {
      const child = stack.pop()!
      const owner = child.parentNode!
      const seen = claimed.get(owner) ?? new Set<ChildNode>()
      claimed.set(owner, seen)
      seen.add(child as ChildNode)
      for (let index = 0; index < child.childNodes.length; index++) stack.push(child.childNodes[index])
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
          const seen = claimed.get(parent) ?? new Set<ChildNode>()
          claimed.set(parent, seen)
          seen.add(textNode)
          return textNode
        }
      }
      const claimedText = claim(
        (node): node is Text => node instanceof Text
          && (content === '' || node.data === content),
        content === '' ? '动态文本节点' : `文本节点 "${content}"`
      )
      if (content === '' && claimedText.data !== '') {
        /*
         * 服务端渲染的是**非空**文本，而客户端此刻要的是空文本 —— 只能临时认领、等绑定 effect 覆写。
         * 这一步过去完全无声：服务端 "Ada" 遇上客户端忘传 state（会渲染 "loading"）时静默变成后者。
         * 现在：默认发一条可观测事件；`strictTextContent` 打开时直接拒绝（报水合不匹配）。
         */
        if (options.strictTextContent) {
          throwHydrationMismatch('content', '动态文本节点（服务端非空 → 客户端为空）', JSON.stringify(claimedText.data), currentParent)
        }
        invokeRuntimeDebug('hydrationProvisionalText', {
          expected: '动态文本节点',
          actual: JSON.stringify(claimedText.data)
        })
      }
      return claimedText
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

    createSvgElement(tag: string): Element {
      if (!hydrating) return document.createElementNS('http://www.w3.org/2000/svg', tag)
      // 水合：按标签名（大小写不敏感，SVG 的 clipPath 等驼峰标签由 HTML 解析器
      // 调整为规范大小写，toLowerCase 后一致）认领服务端序列化的 SVG 元素
      const element = claim(
        (node): node is Element => node instanceof Element
          && node.namespaceURI === 'http://www.w3.org/2000/svg'
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
      /*
       * textContent / innerText 是**文本通道**：Reflect.set 会把已有子节点整棵换掉，
       * 换出来的文本节点不可能在服务端认领表里 → assertAllNodesClaimed 抛 extra-node。
       * 服务端现在把同一段文本当**子节点**序列化（renderer.ts 的 textContent 分支），
       * 所以这里反过来做：把服务端已渲染的那个文本节点**认领**下来当自己的节点，
       * 而不是另造一个。`setTextContent` 只改文本内容、不动节点身份，所以认领后仍可更新。
       * 找不到可选文本节点（服务端渲染的是空文本、或该位置是注释占位）才退回直接赋值。
       */
      if (hydrating && (key === 'textContent' || key === 'innerText')) {
        if (claimTextContent(node, value)) return
      }
      Reflect.set(node, key, value)
      // innerHTML 是原始标记逃生口：赋值会**替换**整棵子树，新节点不可能在服务端认领表里。
      // 服务端原样序列化了同一段标记（renderer.ts serialize），所以这里直接把换出来的
      // 子树整体标记为已认领 —— 否则 assertAllNodesClaimed 必然抛 extra-node。
      if (key === 'innerHTML' && hydrating) markSubtreeClaimed(node)
    },

    setAttribute(node: Element, key: string, value: string): void {
      node.setAttribute(key, value)
    },

    /** 与 DOM 渲染器同语义：不实现就会退化成 setAttribute(key, '')，在客户端留下空属性。 */
    removeAttribute(node: Element, key: string): void {
      node.removeAttribute(key)
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
