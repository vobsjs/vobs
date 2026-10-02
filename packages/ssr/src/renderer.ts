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

    // SSR 节点是数据形态（tag 原样保留 + 序列化），命名空间由客户端解析器在
    // foreign content（<svg> 内）中自动处理，无需单独的 SVG 形态
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
     * 不实现 removeAttribute 时 `ops.removeAttribute` 会退化成 `setAttribute(key, '')`，
     * 产物里就留下 `aria-hidden=""` / `color=""` 这类"看起来设了、其实要删"的属性。
     * SSR 节点是数据形态，直接删键即可（DOM 渲染器与这里语义一致）。
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
  if (index < 0) throw new Error('Vobs SSR: 节点不属于指定父节点')
  parent.children.splice(index, 1)
  child.parent = null
}

function serialize(node: SSRNode | SSRElement): string {
  // 空文本节点序列化为空注释占位：HTML 无法表示空文本节点，客户端水合时认领该
  // 占位并原地替换为真实文本节点（见 hydration.ts createText）。
  if (node.type === 'text') {
    /*
     * 落到这里是 `[object Object]` 时，几乎必然是**数据里混进了对象**（组件节点 / 普通对象
     * 被当成文本插值），而不是作者真想写这串字符。
     *
     * 为什么必须在预渲染阶段报错：HTML 里出现 `[object Object]` 是**静默**的 ——
     * 页面照常出来，只有那一块文字是错的；等到上线肉眼发现，再回头翻是哪一层传错了。
     * 外部踩坑文档里这条**发生过两次**（官网 2026-09-18 与 2026-10-01）。
     *
     * 判据用「内容恰好等于 `[object Object]`」而不是"是不是对象"：走到这里时值早已被
     * 字符串化，类型信息不在了。这串字符作为**作者本意**出现的概率极低，
     * 而作为"对象被字符串化"的痕迹是唯一的常见来源 —— 所以宁可报错也不静默。
     */
    if (node.content === '[object Object]') {
      throw new Error(
        'Vobs SSR: 渲染时把**对象**当成了文本（产物里出现 "[object Object]"）。'
        + '常见原因：把组件节点 / 元素 / 普通对象放进被当作文本插值的表达式，'
        + '或把 JSX 存进数据常量后直接渲染。'
        + '修法：文本位置只放字符串/数字；节点要在 JSX 子节点位置直接使用'
        + '（不要存进数据里再取出来渲染）。'
      )
    }
    return node.content === '' ? '<!---->' : escapeHTML(node.content)
  }
  if (node.type === 'comment') return `<!--${escapeComment(node.content)}-->`

  if (node.tag === 'root') return serializeChildren(node.children)

  const attributes = serializeAttributes(node)
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`
  // innerHTML 是原始标记逃生口（icon-core 的 SVG、ui/combobox 的箭头）：它按定义就是
  // "已经成型的 HTML"，服务端**原样**输出，不做转义 —— 转义会把组件放进去的标签变成文本。
  // 客户端水合对应地把这棵子树整体标记为已认领（见 hydration.ts setProperty）。
  const innerHTML = node.props.innerHTML
  if (typeof innerHTML === 'string') return `<${node.tag}${attributes}>${innerHTML}</${node.tag}>`
  /*
   * textContent / innerText 是**文本通道**，不是属性通道：
   * `propertyAttribute` 的声明式白名单里没有它们（也不该有 —— 文本必须转义后当**子节点**输出），
   * 于是它们此前被静默丢弃、连警告都没有，客户端水合随即以 `extra-node` 失败
   * （.artifacts/reports/ssr.md 缺点 1，实测探针 probe-audit-ssr-2 H1/H3）。
   * 这不是假想用法：packages/table/src/data-table.ts:472 与 column-settings.ts:184 直接这么调，
   * 而且不在 effect 里，SSR 下必然命中。
   * 走 serializeChildren 而不是直接拼串，是为了保留「相邻文本插 <!----> 分隔符」与转义。
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
    // 属性名不能"转义"（HTML 没有名字实体），只能拒绝非法名字 —— 见 isSafeAttributeName
    .filter(([key]) => isSafeAttributeName(key))
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('')
}

/**
 * HTML 属性名是否安全。
 *
 * **属性名没有转义可用**：名字里不存在实体，所以把 key 直接拼进标签时，
 * 只要名字里带 `"` 就能提前闭合属性、注入新属性 —— 实测把 key 设成
 * `a" onmouseover="alert(1)//` 会让产物经真实解析器得到**活的 onmouseover**。
 * 所以唯一的正确做法是**拒绝**（跳过）非法名字：按 HTML 规范的名字产生式，
 * 除空白、" ' > / = 和控制字符之外都算合法。
 */
export function isSafeAttributeName(key: string): boolean {
  return key.length > 0 && !/[\s"'<>/=\u0000-\u001f\u007f]/.test(key)
}

/**
 * 服务端**总是**反射成同名 HTML 属性的一批 DOM property。
 *
 * 为什么需要单独一批：`setProperty(node,'id'|'style'|'title', v)` 是库与生成代码里的常见写法，
 * 而下面那张表原来只认布尔属性与 `value`/`tabIndex`/`className` —— 于是 **SSR 产物里
 * `id` / `style` / `title` 直接消失**，客户端水合后才补上（首屏闪一下、CSS 选择器与
 * `document.getElementById` 在首屏拿不到）。实测对比：
 *
 *   setProperty(el,'id','x')      → DOM: `id="x"`              SSR: 丢失
 *   setProperty(el,'style','color:red') → DOM: `style="color: red;"`  SSR: 丢失
 *   setProperty(el,'title','T')   → DOM: `title="T"`           SSR: 丢失
 *
 * 这三个在**任何**元素上都反射，不像 `value`/`disabled` 那样只在特定元素上反射，
 * 所以不需要按标签名分派 —— 这也正是它们可以安全地无条件序列化的原因。
 */
const UNIVERSAL_REFLECTED_PROPERTIES: ReadonlySet<string> = new Set(['id', 'style', 'title'])

function propertyAttribute(key: string, value: unknown): { key: string; value: string } | null {
  /*
   * 总是反射的同名属性：值只要不是 null/undefined 就序列化。
   * （`style` 由 `setProperty` 归一化成字符串，所以这里直接 String(value) 即可。）
   */
  if (UNIVERSAL_REFLECTED_PROPERTIES.has(key)) {
    if (value === null || value === undefined || value === false) return null
    const text = String(value)
    if (key === 'style') {
      /*
       * `style` 是唯一一个 DOM 会**归一化**的：`setProperty(el,'style','color:red')`
       * 之后 `getAttribute('style')` 是 `"color: red;"`（补空格与结尾分号）。
       * 这里只做最小的等价处理（补结尾分号），不去解析 CSS ——
       * 两边产出的**声明**完全相同，CSS 语义也就相同；差别只在书写形式。
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
