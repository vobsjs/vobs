import type { VobsNode } from '@vobs/vobs'

export type VuiAttributeValue = string | number | boolean | undefined

export type VuiChildren =
  | VobsNode
  | string
  | number
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
