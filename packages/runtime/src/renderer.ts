export interface VobsRenderer<
  NodeType = Node,
  TextNode extends NodeType = NodeType,
  ElementNode extends NodeType = NodeType,
  CommentNode extends NodeType = NodeType
> {
  createText(content: string): TextNode
  createElement(tag: string): ElementNode
  /**
   * Create an SVG-namespace element (http://www.w3.org/2000/svg). Optional: when
   * unimplemented the runtime falls back to createElement (HTML namespace; SVG content
   * will not render). DOM/SSR/hydration renderers must all implement it.
   */
  createSvgElement?(tag: string): ElementNode
  createComment(content: string): CommentNode
  insertBefore(parent: NodeType, child: NodeType, anchor: NodeType | null): void
  removeChild(parent: NodeType, child: NodeType): void
  setTextContent(node: TextNode, content: string): void
  setProperty(node: ElementNode, key: string, value: unknown): void
  setAttribute(node: ElementNode, key: string, value: string): void
  /** Remove an attribute. Optional: when older custom renderers don't implement it, the runtime falls back to setAttribute(key, ''). */
  removeAttribute?(node: ElementNode, key: string): void
  addEventListener(node: ElementNode, event: string, handler: EventListener): void
  removeEventListener(node: ElementNode, event: string, handler: EventListener): void
  nextSibling(node: NodeType): NodeType | null
  clear(container: NodeType): void
  beginHydration?(): void
  completeHydration?(): void
}
