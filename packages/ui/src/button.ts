import { effect } from '@vobs/reactivity'
import {
  createElement,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  hasProp,
  listen,
  mountSlot,
  readProp,
  setOptionalAttribute,
  setOptionalProperty
} from './utils'
import type { VuiCommonProps, VuiEventHandler } from './types'

export type ButtonVariant =
  | 'brand'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'ghost'
  | 'danger'
  | 'danger-strong'
  | 'danger-subtle'
  | 'warning'
  | 'link'

export type ControlSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends VuiCommonProps {
  readonly variant?: ButtonVariant
  readonly size?: ControlSize
  readonly type?: 'button' | 'submit' | 'reset'
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly iconOnly?: boolean
  readonly icon?: VobsNode | (() => VobsNode | null | undefined)
  readonly onClick?: VuiEventHandler<MouseEvent>
}

export function Button(props: ButtonProps = {}): VobsNode {
  const root = createElement('button')

  bindClassList(root, props, () => [
    'vui-btn',
    `vui-btn--${readProp<ButtonVariant>(props, 'variant', 'primary')}`,
    `vui-btn--${readProp<ControlSize>(props, 'size', 'md')}`,
    readProp(props, 'iconOnly', false) ? 'vui-btn--icon' : undefined
  ])
  bindCommonAttributes(root, props, [
    'variant',
    'size',
    'type',
    'disabled',
    'loading',
    'iconOnly',
    'icon',
    'onClick'
  ])

  effect(() => {
    const disabled = readProp(props, 'disabled', false) || readProp(props, 'loading', false)
    setOptionalProperty(root, 'disabled', disabled)
    setOptionalAttribute(root, 'type', readProp(props, 'type', 'button'))
    setOptionalAttribute(root, 'aria-disabled', disabled ? 'true' : undefined)
    setOptionalAttribute(root, 'aria-busy', readProp(props, 'loading', false) ? 'true' : undefined)
  })

  listen(root, 'click', props, 'onClick', () => (
    readProp(props, 'disabled', false) || readProp(props, 'loading', false)
  ))

  if (hasProp(props, 'icon')) mountSlot(root, props, 'icon')
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export interface ButtonGroupProps extends VuiCommonProps {}

export function ButtonGroup(props: ButtonGroupProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-btn-group'])
  bindCommonAttributes(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
