// 编译器静态模板提升的运行时支撑：
// 编译期把完全静态的 JSX 子树序列化为 HTML 字符串，模块加载时解析一次，
// 运行时通过 cloneNode 复制，替代逐个 createElement + setStaticProps + insertBefore。
// 仅适用于 DOM 渲染器（模板本质是 HTML），自定义渲染器场景由编译产物不使用该优化兜底。

const templateCache = new Map<string, HTMLTemplateElement>()

/** Parse a static template once; called at module load for each hoisted template. */
export function createTemplate(html: string): HTMLTemplateElement {
  let template = templateCache.get(html)
  if (!template) {
    template = document.createElement('template')
    template.innerHTML = html
    templateCache.set(html, template)
  }
  return template
}

/** Clone a hoisted template for one mount; the compiled HTML always has a single root element. */
export function cloneTemplate(template: HTMLTemplateElement): Node {
  const root = template.content.firstElementChild
  if (!root) throw new Error('Vobs: 静态模板缺少根元素，请检查编译产物')
  return root.cloneNode(true)
}
