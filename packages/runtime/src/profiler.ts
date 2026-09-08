import { createFragment } from './fragment'
import { insertDynamic, type NodeFactory } from './dynamic'
import type { VobsNode } from './fragment'
import { createOwner } from '@vobs/reactivity'

export interface ProfilerRenderInfo {
  readonly id: string
  readonly phase: 'mount' | 'update'
  readonly duration: number
  readonly timestamp: number
}
export interface ProfilerOptions {
  id: string
  children: NodeFactory
  onRender?: (info: ProfilerRenderInfo) => void
}
export interface ProfilerProps extends ProfilerOptions {}

export function insertProfiler(parent: Node, anchor: Node | null, options: ProfilerOptions): void {
  const profiler = createOwner()
  let mounted = false
  profiler.run(() => {
    insertDynamic(parent, anchor, () => {
      const started = now()
      const value = options.children()
      const info: ProfilerRenderInfo = {
        id: options.id,
        phase: mounted ? 'update' : 'mount',
        duration: Math.max(0, now() - started),
        timestamp: Date.now()
      }
      mounted = true
      try { options.onRender?.(info) } catch { /* profiler callbacks are isolated */ }
      return value
    })
  })
}

export function Profiler(props: ProfilerProps): VobsNode {
  return createFragment((parent, anchor) => insertProfiler(parent, anchor, props))
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}
