import type { VobsRenderer } from '@vobs/runtime'

export type SSRNode = SSRElement | SSRText | SSRComment

export interface SSRElement {
  type: 'element'
  tag: string
  attrs: Record<string, string>
  props: Record<string, unknown>
  children: SSRNode[]
  parent: SSRElement | null
}

export interface SSRText {
  type: 'text'
  content: string
  parent: SSRElement | null
}

export interface SSRComment {
  type: 'comment'
  content: string
  parent: SSRElement | null
}

export interface SSRRenderer {
  readonly container: SSRElement
  readonly renderer: VobsRenderer<SSRNode, SSRText, SSRElement, SSRComment>
  toHTML(node?: SSRNode | SSRElement): string
}

const voidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
])

export function createSSRRenderer(): SSRRenderer {
  const container = createElementNode('root')
  const renderer: VobsRenderer<SSRNode, SSRText, SSRElement, SSRComment> = {
    createText(content: string): SSRText {
      return { type: 'text', content, parent: null }
    },

    createElement(tag: string): SSRElement {
      return createElementNode(tag)
    },

    createComment(content: string): SSRComment {
      return { type: 'comment', content, parent: null }
    },

    insertBefore(parent: SSRElement, child: SSRNode, anchor: SSRNode | null): void {
      if (child.parent) removeChildNode(child.parent, child)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index >= 0) parent.children.splice(index, 0, child)
      else parent.children.push(child)
      child.parent = parent
    },

    removeChild(parent: SSRElement, child: SSRNode): void {
      removeChildNode(parent, child)
    },

    setTextContent(node: SSRText, content: string): void {
      node.content = content
    },

    setProperty(node: SSRElement, key: string, value: unknown): void {
      node.props[key] = value
    },

    setAttribute(node: SSRElement, key: string, value: string): void {
      node.attrs[key] = value
    },

    addEventListener(): void {},

    removeEventListener(): void {},

    nextSibling(node: SSRNode): SSRNode | null {
      const parent = node.parent
      if (!parent) return null
      const index = parent.children.indexOf(node)
      return index >= 0 ? parent.children[index + 1] ?? null : null
    },

    clear(node: SSRElement): void {
      for (const child of node.children) child.parent = null
      node.children.length = 0
    }
  }

  return {
    container,
    renderer,
    toHTML: node => serialize(node ?? container)
  }
}

function createElementNode(tag: string): SSRElement {
  return {
    type: 'element',
    tag,
    attrs: {},
    props: {},
    children: [],
    parent: null
  }
}

function removeChildNode(parent: SSRElement, child: SSRNode): void {
  const index = parent.children.indexOf(child)
  if (index < 0) throw new Error('Vobs SSR: 节点不属于指定父节点')
  parent.children.splice(index, 1)
  child.parent = null
}

function serialize(node: SSRNode | SSRElement): string {
  // 空文本节点序列化为空注释占位：HTML 无法表示空文本节点，客户端水合时认领该
  // 占位并原地替换为真实文本节点（见 hydration.ts createText）。
  if (node.type === 'text') {
    return node.content === '' ? '<!---->' : escapeHTML(node.content)
  }
  if (node.type === 'comment') return `<!--${escapeComment(node.content)}-->`

  if (node.tag === 'root') return serializeChildren(node.children)

  const attributes = serializeAttributes(node)
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`
  return `<${node.tag}${attributes}>${serializeChildren(node.children)}</${node.tag}>`
}

/**
 * 相邻文本节点会被 HTML 解析器合并为一个节点，导致客户端水合的严格逐节点认领必然失配；
 * 在相邻文本之间插入注释分隔符保持节点边界（注释节点会打断解析器合并，水合侧将其视为透明）。
 */
function serializeChildren(children: readonly SSRNode[]): string {
  let html = ''
  let previousIsText = false
  for (const child of children) {
    // 空文本输出为注释占位（非文本形态），天然打断相邻文本合并，不参与分隔符判定
    const isText = child.type === 'text' && child.content !== ''
    if (isText && previousIsText) html += '<!-- -->'
    html += serialize(child)
    previousIsText = isText
  }
  return html
}

function serializeAttributes(node: SSRElement): string {
  const attributes = new Map(Object.entries(node.attrs))
  for (const [key, value] of Object.entries(node.props)) {
    const attribute = propertyAttribute(key, value)
    if (attribute && !attributes.has(attribute.key)) attributes.set(attribute.key, attribute.value)
  }
  return [...attributes.entries()]
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('')
}

function propertyAttribute(key: string, value: unknown): { key: string; value: string } | null {
  const attribute = key === 'className' ? 'class' : key
  const booleanAttributes = new Set([
    'allowFullScreen', 'async', 'autofocus', 'autoPlay', 'checked', 'controls',
    'default', 'defer', 'disabled', 'formNoValidate', 'hidden', 'inert',
    'loop', 'multiple', 'muted', 'noModule', 'noValidate', 'open', 'playsInline',
    'readOnly', 'required', 'reversed', 'selected'
  ])
  if (booleanAttributes.has(key)) return value ? { key: attribute.toLowerCase(), value: '' } : null
  if (key === 'value' || key === 'tabIndex' || key === 'className') {
    if (value === null || value === undefined) return null
    return { key: key === 'tabIndex' ? 'tabindex' : attribute.toLowerCase(), value: String(value) }
  }
  return null
}

export function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function escapeAttribute(value: string): string {
  return escapeHTML(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeComment(value: string): string {
  return value.replace(/--/g, '- -')
}
