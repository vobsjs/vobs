/**
 * SVG 标签与命名空间 —— 编译期判定提升、运行期决定怎么建节点的**同一份依据**。
 *
 * 两处都需要知道「这个名字是不是 SVG 标签」：
 * - 运行期：`document.createElement('rect')` 得到的是 HTMLUnknownElement，
 *   整棵 SVG 子树都不渲染（且没有报错），所以必须走 createElementNS
 * - 编译期：静态子树被提升成 HTML 模板串再 cloneNode，而模板串是**用 HTML 解析器**
 *   解析的 —— `<g>`、`<rect>` 同样变成 HTMLUnknownElement。这条路径漏了整整一个大版本
 *   （1.7.4 只修了 createElement 那条入口，svg.test.ts 也只测那条）。
 */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/**
 * SVG 标签全集（= TypeScript SVGElementTagNameMap 的键，运行时分发依据）。
 * 与 React 的运行时清单同思路：只含纯 SVG 标签，刻意排除与 HTML 同名的
 * a/script/style/title（它们在 JSX 类型里归 HTMLElement，按 HTML 创建）。
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

/** 是否是 SVG 专属标签（按名字判定，不看父级）。 */
export function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag)
}
