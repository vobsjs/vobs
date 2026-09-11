import type { VobsNode } from '@vobs/vobs'

export type VuiAttributeValue = string | number | boolean | undefined

/**
 * 条件 JSX 子节点（`{cond ? <A/> : null}`、`{cond && <B/>}`）在类型层面产出
 * null/false，是合法子节点形态（运行时归一化为空），与节点/文本/数组并列。
 */
export type VuiChildren =
  | VobsNode
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly VuiChildren[]
  | (() => VuiChildren | null | undefined)

export interface VuiCommonProps {
  readonly class?: string
  readonly className?: string
  readonly style?: string
  readonly id?: string
  readonly title?: string
  readonly role?: string
  readonly tabIndex?: number
  readonly children?: VuiChildren
  readonly [name: `aria-${string}`]: VuiAttributeValue
  readonly [name: `data-${string}`]: VuiAttributeValue
}

export type VuiEventHandler<EventType extends Event = Event> = (event: EventType) => void
