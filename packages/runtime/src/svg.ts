/**
 * SVG tags and namespace — the **single source of truth** used both for compile-time
 * hoisting decisions and for runtime node creation.
 *
 * Both sides need to know "is this name an SVG tag":
 * - Runtime: `document.createElement('rect')` yields an HTMLUnknownElement and the whole
 *   SVG subtree fails to render (with no error), so it must go through createElementNS
 * - Compile time: static subtrees are hoisted into an HTML template string and cloneNode'd,
 *   and that string is parsed **by the HTML parser** — `<g>` and `<rect>` likewise become
 *   HTMLUnknownElement, so the static-hoisting path must consult the same tag table
 *   (shared by both paths, so no entry point is missed again).
 */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/**
 * The full set of SVG tags (= the keys of TypeScript's SVGElementTagNameMap; the runtime
 * dispatch basis). Same idea as React's runtime list: pure SVG tags only, deliberately
 * excluding the HTML-homonyms a/script/style/title (they belong to HTMLElement in JSX
 * types and are created as HTML).
 */
export const SVG_TAGS: ReadonlySet<string> = new Set([
  'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc',
  'ellipse', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset',
  'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
  'filter', 'foreignObject', 'g', 'image', 'line', 'linearGradient', 'marker', 'mask',
  'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialGradient',
  'rect', 'set', 'stop', 'svg', 'switch', 'symbol', 'text', 'textPath', 'tspan',
  'use', 'view'
])

/** Whether the name is an SVG-exclusive tag (decided by name alone, not by ancestors). */
export function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag)
}
