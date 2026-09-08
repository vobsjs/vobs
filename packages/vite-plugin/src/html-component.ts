import { parseFragment, type DefaultTreeAdapterMap, type DefaultTreeAdapterTypes } from 'parse5'

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlDocumentFragment = DefaultTreeAdapterTypes.DocumentFragment
type HtmlElement = DefaultTreeAdapterTypes.Element

const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'style'])
const blockedAttributes = /^(?:on[a-z]+|srcdoc|style)$/iu
const urlAttributes = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'])
const safeProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const directivePattern = /^data-vobs-(text|slot|on|bind|prop)(?:-(.+))?$/iu
const safePropertyNames = new Set([
  'value', 'checked', 'selected', 'disabled', 'multiple', 'readonly', 'required',
  'autofocus', 'hidden', 'tabindex'
])

export interface HtmlComponentOptions {
  readonly filename?: string
}

/** Converts a trusted static HTML fragment to Vobs runtime node creation code. */
export function compileHtmlComponent(source: string, options: HtmlComponentOptions = {}): string {
  const fragment = parseFragment(source)
  const body = compileChildren(fragment, options.filename ?? 'component.html')
  const result = body.length === 1 ? body[0] : `createFragment((parent, anchor) => {${body.map(code => `insertBefore(parent, ${code}, anchor);`).join('')}})`

  return `import { addEventListener, bindAttribute, bindProperty, bindText, createElement, createFragment, createText, insertBefore, insertDynamic, setAttribute } from '@vobs/vobs';\nfunction resolveHtmlSlot(value) { const resolved = typeof value === 'function' ? value() : value; if (resolved === undefined || resolved === null || resolved === false) return null; if (typeof resolved === 'string' || typeof resolved === 'number') return createText(String(resolved)); if (Array.isArray(resolved)) return createFragment((parent, anchor) => { for (const item of resolved) { const child = resolveHtmlSlot(item); if (child) insertBefore(parent, child, anchor); } }); return resolved; }\nfunction sanitizeHtmlAttribute(name, value) { const stringValue = String(value ?? ''); if (!['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'].includes(name.toLowerCase())) return stringValue; const normalized = stringValue.trim().toLowerCase(); if (normalized.startsWith('#') || normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) return stringValue; try { const protocol = new URL(normalized, 'https://vobs.invalid/').protocol; return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) ? stringValue : ''; } catch { return ''; } }\nexport default function HtmlComponent(props = {}) { return ${result ?? "createFragment(() => {})"}; }`
}

function compileChildren(parent: HtmlDocumentFragment | HtmlElement, filename: string): string[] {
  return parent.childNodes.flatMap(node => compileNode(node, filename))
}

function compileNode(node: HtmlNode, filename: string): string[] {
  if (node.nodeName === '#text') {
    const value = (node as DefaultTreeAdapterMap['textNode']).value
    return value ? [`createText(${JSON.stringify(value)})`] : []
  }

  if (node.nodeName === '#comment') return []
  if (node.nodeName !== '#document-fragment' && !isElement(node)) return []

  if (isElement(node)) {
    const tag = node.tagName.toLowerCase()
    if (blockedTags.has(tag)) throw new Error(`Vobs HTML component: 禁止使用 <${tag}> (${filename})`)

    const children = compileChildren(node, filename)
    const statements = [`const element = createElement(${JSON.stringify(tag)})`]
    const dynamicText = [] as string[]
    for (const attribute of node.attrs) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value
      const directive = parseDirective(name, value, filename)
      if (directive) {
        if (directive.kind === 'text') {
          dynamicText.push(directive.prop)
        } else if (directive.kind === 'slot') {
          statements.push(`insertDynamic(element, null, () => resolveHtmlSlot(props[${JSON.stringify(directive.prop)}]))`)
        } else if (directive.kind === 'event') {
          statements.push(`addEventListener(element, ${JSON.stringify(directive.name)}, (event) => { const handler = props[${JSON.stringify(directive.prop)}]; if (typeof handler === 'function') handler(event); })`)
        } else if (directive.kind === 'attribute') {
          statements.push(`bindAttribute(element, ${JSON.stringify(directive.name)}, () => sanitizeHtmlAttribute(${JSON.stringify(directive.name)}, props[${JSON.stringify(directive.prop)}] ?? ''))`)
        } else if (directive.kind === 'property') {
          statements.push(`bindProperty(element, ${JSON.stringify(directive.name)}, () => props[${JSON.stringify(directive.prop)}])`)
        }
        continue
      }
      if (blockedAttributes.test(name)) throw new Error(`Vobs HTML component: 禁止使用危险属性 ${attribute.name} (${filename})`)
      if (urlAttributes.has(name) && !isSafeUrl(value)) {
        throw new Error(`Vobs HTML component: 禁止使用危险 URL 属性 ${attribute.name} (${filename})`)
      }
      statements.push(`setAttribute(element, ${JSON.stringify(attribute.name)}, ${JSON.stringify(value)})`)
    }
    if (dynamicText.length > 1) throw new Error(`Vobs HTML component: 一个元素只能使用一个 data-vobs-text 指令 (${filename})`)
    if (dynamicText.length === 1) {
      const text = 'createText("")'
      statements.push(`const text = ${text}`)
      statements.push('insertBefore(element, text, null)')
      statements.push(`bindText(text, () => props[${JSON.stringify(dynamicText[0])}] ?? '')`)
    } else {
      for (const child of children) statements.push(`insertBefore(element, ${child}, null)`)
    }
    statements.push('return element')
    return [`(() => {${statements.join(';')};})()`]
  }

  return compileChildren(node as HtmlDocumentFragment, filename)
}

function isElement(node: HtmlNode): node is HtmlElement {
  return !node.nodeName.startsWith('#')
}

function isSafeUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('#') || normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) return true
  try {
    return safeProtocols.has(new URL(normalized, 'https://vobs.invalid/').protocol)
  } catch {
    return false
  }
}

type HtmlDirective =
  | { readonly kind: 'text' | 'slot'; readonly prop: string }
  | { readonly kind: 'event' | 'attribute' | 'property'; readonly name: string; readonly prop: string }

function parseDirective(name: string, value: string, filename: string): HtmlDirective | null {
  const match = directivePattern.exec(name)
  if (!match) return null
  const kind = match[1].toLowerCase()
  const namePart = match[2]
  const prop = value.trim()
  if (!prop || !/^[A-Za-z_$][\w$]*$/u.test(prop)) {
    throw new Error(`Vobs HTML component: ${name} 必须引用有效的 props 名称 (${filename})`)
  }
  if (kind === 'text' || kind === 'slot') {
    if (namePart) throw new Error(`Vobs HTML component: ${name} 不接受额外名称 (${filename})`)
    return { kind, prop }
  }
  if (!namePart || !/^[a-z][a-z0-9:-]*$/iu.test(namePart)) {
    throw new Error(`Vobs HTML component: ${name} 必须包含有效名称 (${filename})`)
  }
  if (kind === 'on') return { kind: 'event', name: namePart.toLowerCase(), prop }
  if (kind === 'bind') {
    if (namePart.toLowerCase() === 'style') throw new Error(`Vobs HTML component: 不允许动态绑定 style (${filename})`)
    return { kind: 'attribute', name: namePart, prop }
  }
  if (!safePropertyNames.has(namePart.toLowerCase())) {
    throw new Error(`Vobs HTML component: 不允许动态绑定 property ${namePart} (${filename})`)
  }
  return { kind: 'property', name: normalizePropertyName(namePart), prop }
}

function normalizePropertyName(name: string): string {
  return name.toLowerCase() === 'readonly' ? 'readOnly' : name.toLowerCase() === 'tabindex' ? 'tabIndex' : name
}
