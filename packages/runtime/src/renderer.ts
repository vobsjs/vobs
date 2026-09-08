export interface VobsRenderer<
  NodeType = Node,
  TextNode extends NodeType = NodeType,
  ElementNode extends NodeType = NodeType,
  CommentNode extends NodeType = NodeType
> {
  createText(content: string): TextNode
  createElement(tag: string): ElementNode
  createComment(content: string): CommentNode
  insertBefore(parent: NodeType, child: NodeType, anchor: NodeType | null): void
  removeChild(parent: NodeType, child: NodeType): void
  setTextContent(node: TextNode, content: string): void
  setProperty(node: ElementNode, key: string, value: unknown): void
  setAttribute(node: ElementNode, key: string, value: string): void
  addEventListener(node: ElementNode, event: string, handler: EventListener): void
  removeEventListener(node: ElementNode, event: string, handler: EventListener): void
  nextSibling(node: NodeType): NodeType | null
  clear(container: NodeType): void
  beginHydration?(): void
  completeHydration?(): void
}
