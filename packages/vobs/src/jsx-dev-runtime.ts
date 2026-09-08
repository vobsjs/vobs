import {
  createComponent,
  createElement,
  createFragment,
  insertBefore,
  normalizeDynamicChild,
  spreadProps,
  type VobsNode
} from '@vobs/runtime'

export function jsxDEV(
  tag: string | Function,
  props: Record<string, unknown> | null,
  _key?: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown
): VobsNode {
  if (typeof tag === 'function') {
    return createComponent(tag as (props: Record<string, unknown>) => VobsNode, props ?? {})
  }

  const { children, ...attrs } = props ?? {}

  const el = createElement(tag as string)

  spreadProps(el, attrs)

  appendChildren(el, children)

  return el
}

function appendChildren(parent: Node, children: unknown, anchor: Node | null = null): void {
  if (children === undefined || children === null) return

  const childArray = Array.isArray(children) ? children : [children]

  for (const child of childArray) {
    const node = normalizeDynamicChild(child as Parameters<typeof normalizeDynamicChild>[0])
    if (node) insertBefore(parent, node, anchor)
  }
}

export function jsx(tag: string | Function, props: Record<string, unknown> | null): VobsNode {
  return jsxDEV(tag, props)
}

export function jsxs(tag: string | Function, props: Record<string, unknown> | null): VobsNode {
  return jsxDEV(tag, props)
}

export function Fragment(props: { children?: unknown }): VobsNode {
  return createFragment((parent, anchor) => appendChildren(parent, props?.children, anchor))
}

/** Namespace for explicit built-in JSX primitives such as <Vobs.Fragment>. */
export const Vobs = { Fragment }
