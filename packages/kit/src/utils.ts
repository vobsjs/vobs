import { effect } from '@vobs/reactivity'
import {
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  setTextContent,
  type VobsNode
} from '@vobs/vobs'
import type { LayoutCommonProps } from '@vobs/layout'

export function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

export function hasProp(props: object, name: string): boolean {
  return name in props
}

export function bindClassList(
  root: Element,
  props: object,
  readBaseClasses: () => readonly (string | undefined)[]
): void {
  effect(() => {
    setAttribute(root, 'class', [
      ...readBaseClasses(),
      readString(props, 'class'),
      readString(props, 'className')
    ].filter(Boolean).join(' '))
  })
}

export function bindCommonAttributes(root: Element, props: object, skip: readonly string[]): void {
  const ignored = new Set([...skip, 'class', 'className', 'children', 'style'])
  effect(() => {
    for (const name of Object.keys(props)) {
      if (ignored.has(name)) continue
      if (name === 'id' || name === 'title' || name === 'role' || name === 'tabIndex'
        || name.startsWith('aria-') || name.startsWith('data-')) {
        const value = Reflect.get(props, name)
        if (value === undefined || value === null || value === false) removeAttribute(root, normalizeName(name))
        else setAttribute(root, normalizeName(name), String(value))
      }
    }
  })
}

export function bindUserStyle(root: Element, props: object): void {
  effect(() => {
    const style = readString(props, 'style')
    if (style) setAttribute(root, 'style', style)
    else removeAttribute(root, 'style')
  })
}

export function bindTextContent(node: Text, read: () => unknown): void {
  effect(() => setTextContent(node, String(read() ?? '')))
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

function normalizeName(name: string): string {
  return name === 'tabIndex' ? 'tabindex' : name
}

function removeAttribute(node: Element, name: string): void {
  const candidate = node as Element & { removeAttribute?: (attribute: string) => void }
  candidate.removeAttribute?.(name)
}

export type { LayoutCommonProps }
