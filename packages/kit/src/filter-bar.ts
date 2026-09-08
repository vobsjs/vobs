import { addEventListener, createElement, insertBefore, setAttribute, type VobsNode } from '@vobs/vobs'
import { Button } from '@vobs/ui'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { LayoutChildren, LayoutCommonProps } from '@vobs/layout'

export interface KitFilterBarProps extends LayoutCommonProps {
  /** Filter controls rendered before the action buttons. */
  readonly children?: LayoutChildren
  /** Additional actions. Defaults to Search and Reset buttons. */
  readonly actions?: LayoutChildren
  readonly searchLabel?: string
  readonly resetLabel?: string
  readonly onSearch?: () => void
  readonly onReset?: () => void
}

/**
 * A small, unopinionated filter form. It owns submit/reset semantics while
 * leaving field state and query serialization to the page or form model.
 */
export function KitFilterBar(props: KitFilterBarProps = {}): VobsNode {
  const root = createElement('form')
  const fields = createElement('div')
  const actions = createElement('div')

  bindClassList(root, props, () => ['vobs-kit-filter-bar'])
  bindCommonAttributes(root, props, ['actions', 'searchLabel', 'resetLabel', 'onSearch', 'onReset'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'search')

  setAttribute(fields, 'class', 'vobs-kit-filter-bar__fields')
  if (hasProp(props, 'children')) mountSlot(fields, props, 'children')

  setAttribute(actions, 'class', 'vobs-kit-filter-bar__actions')
  insertBefore(actions, Button({
    type: 'submit',
    variant: 'brand',
    children: readProp(props, 'searchLabel', 'Search'),
    onClick: () => undefined
  }), null)
  insertBefore(actions, Button({
    type: 'reset',
    variant: 'secondary',
    children: readProp(props, 'resetLabel', 'Reset'),
    onClick: () => undefined
  }), null)
  if (hasProp(props, 'actions')) mountSlot(actions, props, 'actions')

  insertBefore(root, fields, null)
  insertBefore(root, actions, null)

  addEventListener(root, 'submit', event => {
    event.preventDefault()
    readProp<(() => void) | undefined>(props, 'onSearch', undefined)?.()
  })
  addEventListener(root, 'reset', () => {
    readProp<(() => void) | undefined>(props, 'onReset', undefined)?.()
  })
  return root
}
