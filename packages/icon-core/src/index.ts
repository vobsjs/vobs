import { effect } from '@vobs/reactivity'
import {
  createElement,
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
  setOptionalAttribute(root, 'aria-label', ariaLabel === undefined ? title : undefined)
  setOptionalAttribute(root, 'data-icon-name', options.dataIconName ?? definition?.name)
  setOptionalAttribute(root, 'color', readProp(props, 'color', undefined))

  if (!definition) {
    setProperty(root, 'innerHTML', '')
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
    node.removeAttribute(name)
    return
  }
  setAttribute(node, name, String(value))
}

function clearStaleAttributes(node: Element, next: ReadonlyMap<string, string>): void {
  const previous = (node as Element & { __vobsIconAttributes?: Set<string> }).__vobsIconAttributes ?? new Set<string>()
  for (const name of previous) {
    if (!next.has(name)) node.removeAttribute(name)
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
