// Runtime support for the compiler's static template hoisting:
// at compile time, fully static JSX subtrees are serialized into an HTML string, parsed once
// at module load, and cloned at runtime via cloneNode — replacing per-node
// createElement + setStaticProps + insertBefore.
// DOM renderer only (a template is inherently HTML); for custom renderers, the compiled
// output simply does not use this optimization.

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
  if (!root) throw new Error('Vobs: static template is missing a root element; check the compiled output')
  return root.cloneNode(true)
}
