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

    // SSR nodes are plain data (tag kept verbatim + serialized); the namespace is handled
    // automatically by the client parser in foreign content (inside <svg>), so no separate
    // SVG node shape is needed
    createSvgElement(tag: string): SSRElement {
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

    /*
     * Without implementing removeAttribute, `ops.removeAttribute` degrades to
     * `setAttribute(key, '')`, leaving attributes like `aria-hidden=""` / `color=""` in the
     * output that "look set but should be removed".
     * SSR nodes are plain data, so deleting the keys directly is enough (the DOM renderer
     * shares this semantics).
     */
    removeAttribute(node: SSRElement, key: string): void {
      delete node.attrs[key]
      delete node.props[key]
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
  if (index < 0) throw new Error('Vobs SSR: node does not belong to the given parent')
  parent.children.splice(index, 1)
  child.parent = null
}

function serialize(node: SSRNode | SSRElement): string {
  // Empty text nodes serialize to an empty comment placeholder: HTML cannot represent an
  // empty text node, and client hydration claims the placeholder and replaces it in place
  // with a real text node (see createText in hydration.ts).
  if (node.type === 'text') {
    /*
     * When `[object Xxx]` shows up in text, it is almost certainly an **object leaking into
     * the data** (a component node / element / Map / plain object interpolated as text), not
     * an author who truly wanted these characters.
     *
     * Why this must fail at prerender time: such traces in HTML are **silent** — the page
     * renders as usual with just that one piece of text wrong; it gets spotted by eye after
     * release, and then someone digs back through layers to find who passed it wrong.
     * The external pitfall log recorded this **twice** (website 2026-09-18 and 2026-10-01).
     *
     * The predicate covers the whole `[object Xxx]` family (type name **capitalized** — the
     * fixed shape of `Object.prototype.toString`: `Object` / `HTMLDivElement` / `Map` /
     * `Date`), **not just `[object Object]`**: the **most commonly hit shape**, "a JSX node
     * used as props / stored in data constants", produces `[object HTMLDivElement]` (an
     * — verified empirically: DOM nodes / Maps etc. were missed, and they are exactly the
     * kinds recorded in that document.
     *
     * ⚠️ **Shapes that cannot be recognized (stated honestly)**:
     * - Arrays → `"1,2"`, functions → `"() => void 0"`, dates → `"Thu Jan 01 1970 …"`
     *   These three are **indistinguishable from legitimate text in string form** and cannot
     *   be detected.
     * - They can only be prevented by the discipline of "never put JSX / functions in data
     *   structures" (the document's "four rules for child positions").
     *
     * These characters are extremely unlikely to appear as **author intent**, while "an
     * object got stringified" is the only common source — so fail loudly rather than stay
     * silent.
     */
    if (/\[object [A-Z][A-Za-z]*\]/u.test(node.content)) {
      throw new Error(
        'Vobs SSR: an **object** was rendered as text (the output contains "[object …]").'
        + ' Common causes: putting a component node / element / plain object into an expression'
        + ' interpolated as text, or storing JSX in a data constant and rendering it directly.'
        + ' Fix: only strings/numbers belong in text positions; use nodes directly in JSX child'
        + ' positions (never store them in data and render them later).'
      )
    }
    return node.content === '' ? '<!---->' : escapeHTML(node.content)
  }
  if (node.type === 'comment') return `<!--${escapeComment(node.content)}-->`

  if (node.tag === 'root') return serializeChildren(node.children)

  const attributes = serializeAttributes(node)
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`
  // innerHTML is the raw-markup escape hatch (icon-core SVG, ui/combobox arrow): by
  // definition it is "already-finished HTML" and the server outputs it **verbatim** without
  // escaping — escaping would turn tags the component placed there into visible text.
  // Client hydration correspondingly marks this whole subtree as claimed (see setProperty
  // in hydration.ts).
  const innerHTML = node.props.innerHTML
  if (typeof innerHTML === 'string') return `<${node.tag}${attributes}>${innerHTML}</${node.tag}>`
  /*
   * textContent / innerText are **text channels**, not attribute channels:
   * `propertyAttribute`'s declarative whitelist has no entry for them (nor should it — text
   * must be escaped and emitted as a **child node**), so they would be silently dropped
   * without even a warning, and client hydration would immediately fail with `extra-node`.
   * This is not a hypothetical usage: packages/table/src/data-table.ts:472 and
   * column-settings.ts:184 call it exactly this way, outside any effect — SSR would
   * inevitably hit it.
   * Going through serializeChildren instead of string concatenation preserves both existing
   * guarantees: escaping and the `<!---->` separator between adjacent texts.
   */
  const textContent = node.props.textContent ?? node.props.innerText
  if (typeof textContent === 'string') {
    if (textContent === '') return `<${node.tag}${attributes}></${node.tag}>`
    const text: SSRNode = { type: 'text', content: textContent, parent: null }
    return `<${node.tag}${attributes}>${serializeChildren([text])}</${node.tag}>`
  }
  return `<${node.tag}${attributes}>${serializeChildren(node.children)}</${node.tag}>`
}

/**
 * Adjacent text nodes get merged into one by the HTML parser, which would inevitably break
 * the strict node-by-node claiming on client hydration; a comment separator is inserted
 * between adjacent texts to preserve node boundaries (comment nodes interrupt parser
 * merging, and the hydration side treats them as transparent).
 */
function serializeChildren(children: readonly SSRNode[]): string {
  let html = ''
  let previousIsText = false
  for (const child of children) {
    // Empty text is emitted as a comment placeholder (not a text shape), which naturally
    // interrupts adjacent-text merging and takes no part in separator decisions
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
    // Attribute names cannot be "escaped" (HTML has no name entities); illegal names can
    // only be rejected — see isSafeAttributeName
    .filter(([key]) => isSafeAttributeName(key))
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('')
}

/**
 * Whether an HTML attribute name is safe.
 *
 * **There is no escaping for attribute names**: names have no entities, so when a key is
 * concatenated straight into a tag, any `"` in the name closes the attribute early and
 * injects new ones — empirically, key `a" onmouseover="alert(1)//` yields a **live
 * onmouseover** after the output goes through a real parser.
 * The only correct move is to **reject** (skip) illegal names: per the HTML spec's name
 * production, everything except whitespace, " ' > / = and control characters is legal.
 */
export function isSafeAttributeName(key: string): boolean {
  return key.length > 0 && !/[\s"'<>/=\u0000-\u001f\u007f]/.test(key)
}

/**
 * A set of DOM properties the server **always** reflects into same-named HTML attributes.
 *
 * Why a separate set is needed: `setProperty(node,'id'|'style'|'title', v)` is a common
 * pattern in libraries and generated code, while the table below originally only knew
 * boolean attributes plus `value`/`tabIndex`/`className` — so **`id` / `style` / `title`
 * simply vanished from SSR output** and only appeared after client hydration (first-paint
 * flash; CSS selectors and `document.getElementById` miss them on first paint).
 * Empirical comparison:
 *
 *   setProperty(el,'id','x')      → DOM: `id="x"`              SSR: lost
 *   setProperty(el,'style','color:red') → DOM: `style="color: red;"`  SSR: lost
 *   setProperty(el,'title','T')   → DOM: `title="T"`           SSR: lost
 *
 * These three reflect on **any** element, unlike `value`/`disabled` which reflect only on
 * specific elements, so no per-tag dispatch is needed — which is also exactly why they can
 * be serialized unconditionally and safely.
 */
const UNIVERSAL_REFLECTED_PROPERTIES: ReadonlySet<string> = new Set(['id', 'style', 'title'])

function propertyAttribute(key: string, value: unknown): { key: string; value: string } | null {
  /*
   * Always-reflected same-named properties: serialize the value unless it is
   * null/undefined.
   * (`style` is normalized to a string by `setProperty`, so String(value) suffices here.)
   */
  if (UNIVERSAL_REFLECTED_PROPERTIES.has(key)) {
    if (value === null || value === undefined || value === false) return null
    const text = String(value)
    if (key === 'style') {
      /*
       * `style` is the one property DOM **normalizes**: after
       * `setProperty(el,'style','color:red')`, `getAttribute('style')` is `"color: red;"`
       * (space and trailing semicolon added).
       * Only the minimal equivalent handling is done here (append the trailing semicolon);
       * CSS is not parsed — both sides produce exactly the same **declarations**, so CSS
       * semantics are identical; only the spelling differs.
       */
      const trimmed = text.trim()
      if (trimmed === '') return null
      return { key, value: trimmed.endsWith(';') ? trimmed : `${trimmed};` }
    }
    return { key, value: text }
  }
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
