import { effect } from '@vobs/reactivity'
import {
  createElement,
  removeAttribute,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'

export interface IconDefinition {
  readonly name: string
  readonly path: string
  readonly viewBox?: string
}

export interface SvgIconDefinition {
  readonly name: string
  readonly body: string
  readonly viewBox?: string
  readonly attributes?: Readonly<Record<string, string | number | undefined>>
}

export interface VobsIconProps {
  readonly size?: string | number
  readonly width?: string | number
  readonly height?: string | number
  readonly color?: string
  readonly stroke?: string
  readonly strokeWidth?: string | number
  readonly fill?: string
  readonly class?: string
  readonly className?: string
  readonly style?: string
  readonly id?: string
  readonly title?: string
  readonly role?: string
  readonly tabIndex?: number
  readonly decorative?: boolean
  readonly [name: `aria-${string}`]: string | number | boolean | undefined
  readonly [name: `data-${string}`]: string | number | boolean | undefined
}

export type VobsIconComponent<Props extends VobsIconProps = VobsIconProps> =
  (props?: Props) => VobsNode

export interface SvgIconRenderOptions {
  readonly class?: string
  readonly className?: string
  readonly dataIconName?: string
  readonly defaultSvgAttributes?: Readonly<Record<string, string | number | undefined>>
}

type IconSource = SvgIconDefinition | (() => SvgIconDefinition | undefined)

/**
 * 已经警告过的缺失图标名（按名字去重，避免 effect 每次重跑都刷屏）。
 */
const warnedMissingIcons = new Set<string>()

export function createIcon<const Name extends string>(
  name: Name,
  path: string,
  viewBox = '0 0 24 24'
): IconDefinition & { readonly name: Name } {
  return { name, path, viewBox }
}

export function createSvgIcon<
  const Name extends string,
  Props extends VobsIconProps = VobsIconProps
>(
  definition: SvgIconDefinition & { readonly name: Name }
): VobsIconComponent<Props> {
  const component = (props: Props = {} as Props): VobsNode => (
    createSvgIconNode(definition, props)
  )
  Object.defineProperty(component, 'displayName', { value: definition.name })
  return component
}

export function createSvgIconNode(
  source: IconSource,
  props: VobsIconProps = {},
  options: SvgIconRenderOptions = {}
): VobsNode {
  const root = createElement('span')
  effect(() => {
    updateSvgIconNode(root, typeof source === 'function' ? source() : source, props, options)
  })
  return root
}

function updateSvgIconNode(
  root: Element,
  definition: SvgIconDefinition | undefined,
  props: VobsIconProps,
  options: SvgIconRenderOptions
): void {
  const size = readProp(props, 'size', undefined)
  const width = readProp(props, 'width', size)
  const height = readProp(props, 'height', size)
  const normalizedWidth = normalizeSvgLength(width)
  const normalizedHeight = normalizeSvgLength(height)
  const userClass = [
    readProp<string | undefined>(props, 'class', undefined),
    readProp<string | undefined>(props, 'className', undefined)
  ]
    .filter(hasText)
    .join(' ')
  const className = [options.class, options.className, userClass]
    .filter(hasText)
    .join(' ')
  setAttribute(root, 'class', className)

  const internalStyle = size === undefined ? '' : `width: ${normalizeCssLength(size)}; height: ${normalizeCssLength(size)}`
  const userStyle = readProp<string | undefined>(props, 'style', undefined)
  const style = [internalStyle, userStyle].filter(hasText).join('; ')
  setOptionalAttribute(root, 'style', style || undefined)

  const managedAttributes = new Map<string, string>()
  for (const name of Object.keys(props)) {
    if (name === 'class' || name === 'className' || name === 'style' || name === 'children') continue
    if (!name.startsWith('aria-') && !name.startsWith('data-') && !['id', 'title', 'role', 'tabIndex'].includes(name)) continue
    const value = Reflect.get(props, name)
    if (value === undefined || value === null || value === false) continue
    managedAttributes.set(name === 'tabIndex' ? 'tabindex' : name, String(value))
  }
  for (const [name, value] of managedAttributes) setAttribute(root, name, value)
  clearStaleAttributes(root, managedAttributes)

  const title = readProp(props, 'title', undefined)
  const ariaLabel = Reflect.get(props, 'aria-label')
  const decorative = readProp(props, 'decorative', title === undefined && ariaLabel === undefined)
  setOptionalAttribute(root, 'aria-hidden', decorative ? 'true' : undefined)
  // 作者传了 aria-label 就必须留下（上面 managedAttributes 已经写好）——原来这里传的是
  // `ariaLabel === undefined ? title : undefined`，于是**作者自己给的可读名字被当场删掉**：
  // 实测 Camera({'aria-label':'Foo'}) 得到 aria-label=null，既不隐藏也没有名字。
  setOptionalAttribute(root, 'aria-label', ariaLabel === undefined ? title : ariaLabel)
  setOptionalAttribute(root, 'data-icon-name', options.dataIconName ?? definition?.name)
  setOptionalAttribute(root, 'color', readProp(props, 'color', undefined))

  if (!definition) {
    setProperty(root, 'innerHTML', '')
    /*
     * 查表 miss 时**不能完全无声**（外部踩坑文档 H 条：lucide 图标白名单静默空白）。
     *
     * 那个坑的机制是「名字 → 图标定义」的查表 miss 返回空、渲染成空 span、不报错，
     * 于是新增页面用了没登记的图标时，界面上只是"那里没有东西"，得靠人眼发现。
     * 文档记的是它已经踩过三次变体（keyboard / upload-cloud / triangle-alert，以及
     * `ICONS` / `FAVORITES` 双清单混淆）。
     *
     * 这里能做的**不是**替应用维护白名单（查表在应用侧），而是把「miss」这件事说出来。
     * 拿得到名字（`options.dataIconName`）就报出名字 —— 那是排查时唯一有用的信息。
     *
     * 用 `console.warn` 而不是抛错：库不该因为一个图标缺失就把整棵渲染树打断；
     * 而且这条路径在 effect 里，抛错会让"少一个图标"升级成"整块渲染失败"。
     */
    const label = options.dataIconName
    const key = label ?? '(未提供名字)'
    if (!warnedMissingIcons.has(key)) {
      warnedMissingIcons.add(key)
      // eslint-disable-next-line no-console -- 这是刻意的可观测出口
      console.warn(
        `[Vobs Icon] 图标${label === undefined ? '' : ` “${label}”`}没有定义，渲染为空。`
        + '常见原因：按名字查白名单时 miss（名字没登记 / 登记到了另一个清单）。'
        + '若这是有意的空占位，忽略本条即可。'
      )
    }
    return
  }

  const svgAttributes = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: definition.viewBox ?? '0 0 24 24',
    ...options.defaultSvgAttributes,
    ...definition.attributes,
    ...(normalizedWidth === undefined ? {} : { width: normalizedWidth }),
    ...(normalizedHeight === undefined ? {} : { height: normalizedHeight }),
    ...(readProp(props, 'color', undefined) === undefined ? {} : { color: readProp(props, 'color', undefined) }),
    ...(readProp(props, 'stroke', undefined) === undefined ? {} : { stroke: readProp(props, 'stroke', undefined) }),
    ...(readProp(props, 'fill', undefined) === undefined ? {} : { fill: readProp(props, 'fill', undefined) }),
    ...(readProp(props, 'strokeWidth', undefined) === undefined ? {} : { 'stroke-width': readProp(props, 'strokeWidth', undefined) })
  }
  const markup = Object.entries(svgAttributes)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}="${escapeXml(String(value))}"`)
    .join(' ')
  const titleMarkup = title === undefined ? '' : `<title>${escapeXml(title)}</title>`
  setProperty(root, 'innerHTML', `<svg ${markup} aria-hidden="true">${titleMarkup}${definition.body}</svg>`)
}

function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

function normalizeSvgLength(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? String(value) : value
}

function normalizeCssLength(value: string | number): string {
  return typeof value === 'number' || /^\d+(?:\.\d+)?$/u.test(value) ? `${value}px` : value
}

function setOptionalAttribute(node: Element, name: string, value: unknown): void {
  if (value === undefined || value === null || value === false || value === '') {
    // 走框架 op：SSR 渲染器**没有**原生 removeAttribute（它是 VobsRenderer 里的可选项），
    // 服务端数据节点上更不存在这个方法 —— 直接调原生会让 renderToString 整棵树抛 TypeError。
    removeAttribute(node, name)
    return
  }
  setAttribute(node, name, String(value))
}

function clearStaleAttributes(node: Element, next: ReadonlyMap<string, string>): void {
  const previous = (node as Element & { __vobsIconAttributes?: Set<string> }).__vobsIconAttributes ?? new Set<string>()
  for (const name of previous) {
    if (!next.has(name)) removeAttribute(node, name)
  }
  ;(node as Element & { __vobsIconAttributes?: Set<string> }).__vobsIconAttributes = new Set(next.keys())
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}
