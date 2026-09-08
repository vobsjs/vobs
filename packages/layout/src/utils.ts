import { effect } from '@vobs/reactivity'
import {
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  setProperty,
  setTextContent,
  type VobsNode
} from '@vobs/vobs'
import type { LayoutAttributeValue, LayoutCommonProps } from './types'

export function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

export function hasProp(props: object, name: string): boolean {
  return name in props
}

export function classNames(...values: readonly (string | false | null | undefined)[]): string {
  return values
    .flatMap(value => typeof value === 'string' ? value.trim().split(/\s+/u) : [])
    .filter(Boolean)
    .join(' ')
}

export function bindClassList(
  root: Element,
  props: object,
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
  props: object,
  skip: readonly string[] = []
): void {
  const ignored = new Set(skip)
  ignored.add('class')
  ignored.add('className')
  ignored.add('children')
  ignored.add('style')

  effect(() => {
    const next = new Map<string, string>()
    for (const name of Object.keys(props)) {
      if (ignored.has(name) || !isCommonAttribute(name)) continue
      const normalized = normalizeAttribute(name, Reflect.get(props, name))
      if (normalized) next.set(normalized.name, normalized.value)
    }

    const managed = managedAttributes.get(root) ?? new Set<string>()
    for (const name of managed) {
      if (!next.has(name)) removeAttribute(root, name)
    }
    for (const [name, value] of next) setAttribute(root, name, value)
    managedAttributes.set(root, new Set(next.keys()))
  })
}

export function bindUserStyle(root: Element, props: object, internal?: () => string): void {
  effect(() => {
    const values = [internal?.() ?? '', readString(props, 'style') ?? ''].filter(Boolean)
    if (values.length > 0) setAttribute(root, 'style', values.join('; '))
    else removeAttribute(root, 'style')
  })
}

export function bindTextContent(node: Text, read: () => unknown): void {
  effect(() => {
    setTextContent(node, String(read() ?? ''))
  })
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

export function mountSlot(parent: Node, props: object, name: string): void {
  insertDynamic(parent, null, () => resolveSlot(Reflect.get(props, name)))
}

export function resolveSlot(value: unknown): VobsNode | null {
  const resolved = typeof value === 'function' ? value() : value
  if (resolved === undefined || resolved === null || resolved === false) return null
  if (typeof resolved === 'string' || typeof resolved === 'number') return createText(String(resolved))
  if (Array.isArray(resolved)) {
    return createFragment((parent, anchor) => {
      for (const child of resolved) {
        const node = resolveSlot(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return resolved as VobsNode
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
  return {
    name: name === 'tabIndex' ? 'tabindex' : name,
    value: String(value)
  }
}

function removeAttribute(node: Element, name: string): void {
  const candidate = node as Element & { removeAttribute?: (attribute: string) => void }
  candidate.removeAttribute?.(name)
}

const managedAttributes = new WeakMap<object, Set<string>>()

export type LayoutProps = LayoutCommonProps
export type { LayoutAttributeValue }
