export interface VobsRenderer<
  NodeType = Node,
  TextNode extends NodeType = NodeType,
  ElementNode extends NodeType = NodeType,
  CommentNode extends NodeType = NodeType
> {
  createText(content: string): TextNode
  createElement(tag: string): ElementNode
  /**
   * 创建 SVG 命名空间元素（http://www.w3.org/2000/svg）。可选：未实现时运行时按
   * createElement 兜底（HTML namespace，SVG 内容不渲染）。DOM/SSR/水合渲染器均需实现。
   */
  createSvgElement?(tag: string): ElementNode
  createComment(content: string): CommentNode
  insertBefore(parent: NodeType, child: NodeType, anchor: NodeType | null): void
  removeChild(parent: NodeType, child: NodeType): void
  setTextContent(node: TextNode, content: string): void
  setProperty(node: ElementNode, key: string, value: unknown): void
  setAttribute(node: ElementNode, key: string, value: string): void
  /** 删除 attribute。可选：老自定义渲染器没实现时运行时退回 setAttribute(key, '')。 */
  removeAttribute?(node: ElementNode, key: string): void
  addEventListener(node: ElementNode, event: string, handler: EventListener): void
  removeEventListener(node: ElementNode, event: string, handler: EventListener): void
  nextSibling(node: NodeType): NodeType | null
  clear(container: NodeType): void
  beginHydration?(): void
  completeHydration?(): void
}
