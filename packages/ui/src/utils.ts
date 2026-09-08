import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  setProperty,
  setTextContent,
  type VobsNode
} from '@vobs/vobs'
import type { VuiCommonProps } from './types'

type VuiProps = VuiCommonProps | object

export function classNames(...values: readonly (string | false | null | undefined)[]): string {
  return values
    .flatMap(value => typeof value === 'string' ? value.trim().split(/\s+/u) : [])
    .filter(Boolean)
    .join(' ')
}

export function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

export function hasProp(props: object, name: string): boolean {
  return name in props
}

export function bindClass(
  root: Element,
  props: VuiProps,
  ...baseClasses: readonly (string | undefined)[]
): void {
  effect(() => {
    setAttribute(root, 'class', classNames(
      ...baseClasses,
      readString(props, 'class'),
      readString(props, 'className')
    ))
  })
}

export function bindClassList(
  root: Element,
  props: VuiProps,
  readBaseClasses: () => readonly (string | undefined)[]
): void {
  effect(() => {
    setAttribute(root, 'class', classNames(
      ...readBaseClasses(),
      readString(props, 'class'),
      readString(props, 'className')
    ))
  })
}

export function bindCommonAttributes(
  root: Element,
  props: VuiProps,
  skip: readonly string[] = [],
  options: { readonly includeDataAria?: boolean } = {}
): void {
  const ignored = new Set(skip)
  ignored.add('class')
  ignored.add('className')
  ignored.add('children')
  ignored.add('style')

  effect(() => {
    const next = new Map<string, string>()
    for (const name of Object.keys(props)) {
      if (ignored.has(name) || name.startsWith('on')) continue
      if (!isCommonAttribute(name)) continue
      if (options.includeDataAria === false && (name.startsWith('aria-') || name.startsWith('data-'))) continue

      const value = Reflect.get(props, name)
      const normalized = normalizeAttribute(name, value)
      if (normalized !== undefined) next.set(normalized.name, normalized.value)
    }

    const managed = getManagedAttributes(root)
    for (const name of managed) {
      if (!next.has(name)) removeAttribute(root, name)
    }
    for (const [name, value] of next) setAttribute(root, name, value)
    setManagedAttributes(root, next.keys())
  })
}

export function bindUserStyle(root: Element, props: VuiProps): void {
  bindStyle(root, props, () => '')
}

export function bindStyle(root: Element, props: VuiProps, createStyle: () => string): void {
  effect(() => {
    const userStyle = readString(props, 'style')
    const internalStyle = createStyle()
    const style = [internalStyle, userStyle].filter(Boolean).join('; ')
    if (style) setAttribute(root, 'style', style)
    else removeAttribute(root, 'style')
  })
}

export function bindTextContent(
  node: Text,
  read: () => unknown
): void {
  effect(() => {
    setTextContent(node, String(read() ?? ''))
  })
}

export function bindPropertyValue(
  node: Element,
  name: string,
  read: () => unknown
): void {
  effect(() => setProperty(node, name, read()))
}

export function bindAttributeValue(
  node: Element,
  name: string,
  read: () => unknown
): void {
  effect(() => {
    const value = read()
    if (value === undefined || value === null || value === false) removeAttribute(node, name)
    else setAttribute(node, name, String(value))
  })
}

export function listen(
  root: Element,
  event: string,
  props: object,
  propName: string,
  disabled?: () => boolean
): void {
  addEventListener(root, event, (reason: Event) => {
    if (disabled?.()) return
    const handler = Reflect.get(props, propName)
    if (typeof handler === 'function') handler(reason)
  })
}

export function mountSlot(
  parent: Node,
  props: object,
  propName: string
): void {
  insertDynamic(parent, null, () => resolveSlot(Reflect.get(props, propName)))
}

export function resolveSlot(value: unknown): VobsNode | null {
  const resolved = typeof value === 'function' ? value() : value
  if (resolved === undefined || resolved === null || resolved === false) return null
  if (typeof resolved === 'string' || typeof resolved === 'number') return createText(String(resolved))
  if (Array.isArray(resolved)) {
    const children = resolved
    return createFragment((parent, anchor) => {
      for (const child of children) {
        const node = resolveSlot(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return resolved as VobsNode
}

export function setOptionalAttribute(node: Element, name: string, value: unknown): void {
  if (value === undefined || value === null || value === false || value === '') {
    removeAttribute(node, name)
    return
  }
  setAttribute(node, name, String(value))
}

export function setOptionalProperty(node: Element, name: string, value: unknown): void {
  if (value === undefined || value === null) return
  setProperty(node, name, value)
}

function readString(props: object, name: string): string | undefined {
  const value = Reflect.get(props, name)
  return typeof value === 'string' ? value : undefined
}

function isCommonAttribute(name: string): boolean {
  return name === 'id'
    || name === 'title'
    || name === 'role'
    || name === 'tabIndex'
    || name.startsWith('aria-')
    || name.startsWith('data-')
}

function normalizeAttribute(name: string, value: unknown): { name: string; value: string } | undefined {
  if (value === undefined || value === null) return undefined
  if (value === false && !name.startsWith('aria-') && !name.startsWith('data-')) return undefined
  return { name: name === 'tabIndex' ? 'tabindex' : name, value: String(value) }
}

const managedAttributes = new WeakMap<object, Set<string>>()

function getManagedAttributes(node: Element): Set<string> {
  return managedAttributes.get(node) ?? new Set<string>()
}

function setManagedAttributes(node: Element, names: IterableIterator<string>): void {
  managedAttributes.set(node, new Set(names))
}

function removeAttribute(node: Element, name: string): void {
  const candidate = node as Element & { removeAttribute?: (attribute: string) => void }
  candidate.removeAttribute?.(name)
}
