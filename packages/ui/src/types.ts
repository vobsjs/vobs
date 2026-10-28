import type { VobsNode } from '@vobs/vobs'

export type VuiAttributeValue = string | number | boolean | undefined

/**
 * Conditional JSX children (`{cond ? <A/> : null}`, `{cond && <B/>}`) produce
 * null/false at the type level; they are legitimate child forms (normalized to
 * empty at runtime), listed alongside nodes/text/arrays.
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
