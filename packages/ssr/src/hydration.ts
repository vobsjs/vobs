import { describeDebugNode, invokeRuntimeDebug, type VobsRenderer } from '@vobs/runtime'

export interface HydrationRenderer {
  readonly renderer: VobsRenderer<Node, Text, Element, Comment>
}

export interface HydrationRendererOptions {
  /**
   * Strict mode. When the server rendered **non-empty text** while the client currently asks
   * for an empty text node (which can only be provisionally claimed and overwritten later by
   * the bound effect), the default behavior is "claim anyway + emit a
   * `hydrationProvisionalText` event"; enabling this option **throws a hydration mismatch**
   * (`kind: 'content'`) instead — upgrading "the value was silently swapped" from observable
   * to rejectable.
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
   * Boundary comment inserted by SSR serialization between adjacent text nodes (see
   * serializeChildren in renderer.ts). It only exists to stop the HTML parser from merging
   * text nodes; it takes no part in client declarations and is treated as transparent by
   * both claiming and integrity checks.
   */
  function isSeparatorComment(node: ChildNode): boolean {
    return node instanceof Comment && node.data === ' '
  }

  function tryClaim<T extends ChildNode>(
    predicate: (node: ChildNode) => node is T
  ): T | null {
    // Claim within the current parent first; on failure, walk up the ancestor chain to the
    // hydration container — the "create siblings consecutively, then insert them in one go"
    // output pattern (array maps via insertDynamicValue/insertList) can claim the next
    // sibling while the creation cursor is still inside the previous element; the fallback
    // scan lets such legitimate output be claimed correctly in document order.
    // Only direct children of each level are scanned: extra server-side nodes are never
    // mistakenly claimed here — assertAllNodesClaimed reports them precisely as extra-node
    // when hydration completes.
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
     * The `actual` used for diagnostics. It originally only scanned `querySelectorAll('*')`
     * (**elements only**), so `actual?.nodeType === 3` never held and the `kind: 'content'`
     * branch was **unreachable** — the most typical hydration difference, "expected text but
     * the DOM holds different text", was only reported as missing-node with actual=<none>.
     * When no unclaimed element is found, this now keeps looking for unclaimed **text
     * nodes**, making the content branch genuinely reachable.
     */
    const actual = [...container.querySelectorAll('*')]
      .find(node => !isSeparatorComment(node) && !isClaimed(node))
      ?? firstUnclaimedText()
    throwHydrationMismatch(
      actual?.nodeType === 3 && expected.startsWith('Text node') ? 'content' : 'missing-node',
      expected,
      actual ? describeHydrationNode(actual) : '<none>',
      currentParent
    )
  }

  /** Finds the first unclaimed text node in document order (for the diagnostics above). */
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
   * Claims a server-rendered text node to back
   * `setProperty(node, 'textContent'|'innerText', value)`.
   *
   * Only nodes meeting both conditions below are claimed, to avoid "grabbing the wrong
   * node":
   * 1. Not yet claimed (so text nodes needed by other bindings are not stolen);
   * 2. The server text is **character-for-character identical** to the client value — any
   *    difference means the server rendered something else, in which case we fall back to
   *    a direct assignment and let `assertAllNodesClaimed` report the difference honestly
   *    rather than mask it.
   *
   * Returns true when an agreed node fully handled it, so the caller skips Reflect.set.
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

  /** Marks an entire subtree as claimed (nodes swapped in by innerHTML cannot be matched one by one against the server output). */
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
      // After hydration completes, fall back to real DOM creation: later dynamic
      // re-renders (branch rebuilds on state switches, etc.) need brand-new nodes and can
      // no longer go through claiming (the server DOM was fully claimed long ago).
      if (!hydrating) return document.createTextNode(content)
      // Empty dynamic text: SSR emits an empty comment placeholder (<!---->; HTML cannot
      // represent an empty text node).
      // 1) Server value was empty → the placeholder exists: claim the placeholder comment
      //    and replace it in place with a real text node — the position is exact and no
      //    following sibling text gets mistakenly grabbed;
      // 2) Server value was non-empty → no placeholder exists, the DOM holds real text:
      //    claim any unclaimed text (the bound effect overwrites it with the real value
      //    right after).
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
        content === '' ? 'dynamic text node' : `Text node "${content}"`
      )
      if (content === '' && claimedText.data !== '') {
        /*
         * The server rendered **non-empty** text while the client currently wants empty
         * text — it can only be provisionally claimed and overwritten by the bound effect.
         * This used to be completely silent: server "Ada" meeting a client that forgot to
         * pass state (rendering "loading") quietly became the latter.
         * Now: an observable event is emitted by default; with `strictTextContent` on it is
         * rejected outright (a hydration mismatch is thrown).
         */
        if (options.strictTextContent) {
          throwHydrationMismatch('content', 'dynamic text node (server non-empty → client empty)', JSON.stringify(claimedText.data), currentParent)
        }
        invokeRuntimeDebug('hydrationProvisionalText', {
          expected: 'dynamic text node',
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
      // Hydration: claim the server-serialized SVG element by tag name (case-insensitive;
      // camelCase SVG tags like clipPath get normalized by the HTML parser to canonical
      // casing, so toLowerCase matches on both sides)
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
        `Comment "${content}"`
      )
    },

    insertBefore(parent: Node, child: Node, anchor: Node | null): void {
      if (hydrating) {
        // Nodes newly created during hydration (empty dynamic text, etc.) have no
        // counterpart in the server DOM: really insert them before the dynamic slot anchor
        // and record them as claimed.
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
       * textContent / innerText are **text channels**: Reflect.set swaps out the entire set
       * of existing child nodes, and text nodes produced that way can never be in the
       * server claim table → assertAllNodesClaimed throws extra-node.
       * The server now serializes the same text as a **child node** (the textContent branch
       * in renderer.ts), so this side does the reverse: **claim** the text node the server
       * already rendered as its own node instead of building another one.
       * `setTextContent` only changes text content, not node identity, so the claimed node
       * can still be updated afterwards.
       * Only when no eligible text node exists (the server rendered empty text, or the
       * position holds a comment placeholder) does it fall back to direct assignment.
       */
      if (hydrating && (key === 'textContent' || key === 'innerText')) {
        if (claimTextContent(node, value)) return
      }
      Reflect.set(node, key, value)
      // innerHTML is the raw-markup escape hatch: assignment **replaces** the whole subtree,
      // and the new nodes can never be in the server claim table.
      // The server serialized the same markup verbatim (serialize in renderer.ts), so the
      // swapped-in subtree is marked claimed as a whole — otherwise assertAllNodesClaimed
      // would inevitably throw extra-node.
      if (key === 'innerHTML' && hydrating) markSubtreeClaimed(node)
    },

    setAttribute(node: Element, key: string, value: string): void {
      node.setAttribute(key, value)
    },

    /** Same semantics as the DOM renderer: leaving this unimplemented degrades to setAttribute(key, ''), leaving an empty attribute on the client. */
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
    ? 'Vobs hydration: the server DOM contains nodes not declared by the client'
    : kind === 'position'
      ? 'Vobs hydration: node position does not match the client render result'
      : `Vobs hydration: no matching ${expected} found`
  const details = { kind, expected, actual, path, message } as const
  // The message carries the key diagnostics itself (the browser console cannot see the
  // vobsHydration attachment), making hydration differences easy to locate directly.
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
