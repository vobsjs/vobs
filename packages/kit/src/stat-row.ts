import { createElement, type VobsNode } from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  mountSlot,
  readProp
} from './utils'
import type { LayoutChildren, LayoutCommonProps } from '@vobs/layout'

export type KitStatRowCols = 3 | 4

export interface KitStatRowProps extends LayoutCommonProps {
  /** Column count of the metric grid. */
  readonly cols?: KitStatRowCols
  readonly children?: LayoutChildren
}

/**
 * Metric row: sits between the toolbar and the table panel, stays put with the
 * page header (never scrolls away). Uniform grid instead of hand-written
 * grid/blk class mixes; collapses to a single column on narrow viewports.
 */
export function KitStatRow(props: KitStatRowProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vobs-kit-stat-row',
    `vobs-kit-stat-row--cols-${readProp<KitStatRowCols>(props, 'cols', 3)}`
  ])
  bindCommonAttributes(root, props, ['cols', 'children'])
  bindUserStyle(root, props)
  if (props.children !== undefined) mountSlot(root, props, 'children')
  return root
}
