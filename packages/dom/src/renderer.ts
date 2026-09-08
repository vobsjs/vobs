// 浏览器 DOM 适配器

import type { VobsRenderer } from '@vobs/runtime'

export function createDOMRenderer(): VobsRenderer<Node, Text, Element, Comment> {
  return {
    createText(content: string): Text {
      return document.createTextNode(content)
    },

    createElement(tag: string): Element {
      return document.createElement(tag)
    },

    createComment(content: string): Comment {
      return document.createComment(content)
    },

    insertBefore(parent: Node, child: Node, anchor: Node | null): void {
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

    clear(container: Node): void {
      container.textContent = ''
    }
  }
}
