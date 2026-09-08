import type { VobsNode } from '@vobs/vobs'

export type TransitionStyle = Readonly<Record<string, string | number | null | undefined>>

export interface TransitionPhase {
  readonly duration?: number
  readonly easing?: string
  readonly from?: TransitionStyle
  readonly to?: TransitionStyle
}

export type TransitionPhaseName = 'enter' | 'leave'

export interface TransitionRun {
  readonly cancel: () => void
}

export interface TransitionDriverOptions {
  readonly name: string
  readonly phase: TransitionPhase | undefined
  readonly duration: number
  readonly css: boolean
  readonly reducedMotion: boolean
}

export interface TransitionDriver {
  run(
    node: VobsNode,
    phase: TransitionPhaseName,
    options: TransitionDriverOptions,
    done: () => void
  ): TransitionRun
}

export interface TransitionCallbacks {
  readonly onBeforeEnter?: (element: Element) => void
  readonly onEnter?: (element: Element) => void
  readonly onAfterEnter?: (element: Element) => void
  readonly onEnterCancelled?: (element: Element) => void
  readonly onBeforeLeave?: (element: Element) => void
  readonly onLeave?: (element: Element) => void
  readonly onAfterLeave?: (element: Element) => void
  readonly onLeaveCancelled?: (element: Element) => void
}

export interface TransitionOptions extends TransitionCallbacks {
  /** CSS class prefix. `fade` produces `fade-enter-from`, `fade-leave-to`, etc. */
  readonly name?: string
  /** Applies CSS lifecycle classes. Defaults to true. */
  readonly css?: boolean
  /** Shared fallback duration in milliseconds when a phase has no duration. */
  readonly duration?: number
  readonly enter?: TransitionPhase
  readonly leave?: TransitionPhase
  readonly driver?: TransitionDriver
  /** Respects `prefers-reduced-motion` by default in DOM environments. */
  readonly reducedMotion?: boolean
  /** Animates the initial visible branch when true. */
  readonly appear?: boolean
}

export type TransitionChildren =
  | VobsNode
  | string
  | number
  | null
  | undefined
  | false
  | readonly TransitionChildren[]
  | (() => TransitionChildren)

export interface TransitionProps extends TransitionOptions {
  /** Omit `show` to render and enter once. */
  readonly show?: boolean
  readonly children?: TransitionChildren
}

export interface TransitionGroupProps<Item = unknown> extends TransitionOptions {
  /** Explicit keyed input is the stable API for reactive lists. */
  readonly items?: readonly Item[]
  readonly keyOf?: (item: Item, index: number) => unknown
  readonly renderItem?: (item: Item, index: number) => TransitionChildren
  /** Compatibility input for a stable children array; explicit keys are preferred. */
  readonly children?: TransitionChildren
}

export type TransitionStatus = 'entering' | 'entered' | 'leaving'
