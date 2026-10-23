import { createElement, insertBefore, setAttribute, type VobsNode } from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { LayoutChildren, LayoutCommonProps } from '@vobs/layout'

export interface KitTablePanelProps extends LayoutCommonProps {
  readonly children?: LayoutChildren
  /** Adds inner padding and lets the panel itself scroll (card-style lists). */
  readonly pad?: boolean
  /** Wraps children in a scrollable layer (bare lists inside the shell card). */
  readonly scroll?: boolean
}

/**
 * Table/list shell card: border + radius + overflow hidden, so scrolling only
 * ever happens inside it. Two content modes:
 * ① wrap a DataTable — the table stretches to fill the panel and its sticky
 *    header keeps working;
 * ② bare list content — pass `scroll` to wrap children in a scrollable layer,
 *    or `pad` for a padded, self-scrolling card.
 * The page header, toolbar and stat row above it never scroll away.
 */
export function KitTablePanel(props: KitTablePanelProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vobs-kit-table-panel',
    readProp(props, 'pad', false) ? 'vobs-kit-table-panel--pad' : undefined
  ])
  bindCommonAttributes(root, props, ['children', 'pad', 'scroll'])
  bindUserStyle(root, props)
  if (readProp(props, 'scroll', false)) {
    const scroller = createElement('div')
    setAttribute(scroller, 'class', 'vobs-kit-table-panel__scroll')
    if (hasProp(props, 'children')) mountSlot(scroller, props, 'children')
    insertBefore(root, scroller, null)
  } else if (hasProp(props, 'children')) {
    mountSlot(root, props, 'children')
  }
  return root
}
