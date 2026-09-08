import { getCurrentOwner } from '@vobs/reactivity'
import { createComment, getRenderer } from './ops'

export interface VobsFragment {
  readonly kind: 'vobs-fragment'
  readonly start: Node
  readonly end: Node
  readonly mount: (parent: Node, anchor: Node | null) => void
  readonly unmount: (parent: Node) => void
}

export type VobsNode = Node | VobsFragment
export type FragmentFactory = (parent: Node, anchor: Node) => void

export function createFragment(factory: FragmentFactory): VobsFragment {
  const start = createComment('vobs:fragment:start')
  const end = createComment('vobs:fragment:end')
  let parent: Node | null = null
  let initialized = false
  const owner = getCurrentOwner()

  const fragment: VobsFragment = {
    kind: 'vobs-fragment',
    start,
    end,
    mount(nextParent, anchor): void {
      if (parent && parent !== nextParent) {
        throw new Error('Vobs Fragment: 不能跨父节点移动 Fragment')
      }

      if (initialized) {
        moveRange(nextParent, start, end, anchor)
        return
      }

      const renderer = getRenderer()
      renderer.insertBefore(nextParent, start, anchor)
      renderer.insertBefore(nextParent, end, anchor)
      parent = nextParent
      initialized = true
      if (owner) owner.run(() => factory(nextParent, end))
      else factory(nextParent, end)
    },
    unmount(nextParent): void {
      if (!initialized || parent !== nextParent) {
        throw new Error('Vobs Fragment: Fragment 不属于指定父节点')
      }
      const renderer = getRenderer()
      let current = renderer.nextSibling(start)
      while (current && current !== end) {
        const next = renderer.nextSibling(current)
        renderer.removeChild(nextParent, current)
        current = next
      }
      renderer.removeChild(nextParent, start)
      renderer.removeChild(nextParent, end)
      parent = null
      initialized = false
    }
  }
  return fragment
}

export function isVobsFragment(value: unknown): value is VobsFragment {
  return Boolean(value) && typeof value === 'object' && (value as VobsFragment).kind === 'vobs-fragment'
}

function moveRange(parent: Node, start: Node, end: Node, anchor: Node | null): void {
  const renderer = getRenderer()
  const nodes: Node[] = [start]
  let current = renderer.nextSibling(start)
  while (current) {
    nodes.push(current)
    if (current === end) break
    current = renderer.nextSibling(current)
  }
  if (nodes[nodes.length - 1] !== end) {
    throw new Error('Vobs Fragment: 找不到结束锚点')
  }
  for (const node of nodes) renderer.insertBefore(parent, node, anchor)
}
