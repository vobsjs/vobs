import { createElement, setAttribute, type VobsNode } from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { LayoutChildren, LayoutCommonProps } from '@vobs/layout'

export type KitPageActionsAlign = 'start' | 'center' | 'end' | 'between'

export interface KitPageActionsProps extends LayoutCommonProps {
  readonly children?: LayoutChildren
  readonly align?: KitPageActionsAlign
}

/** Consistent action row for page-level create/export/bulk operations. */
export function KitPageActions(props: KitPageActionsProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vobs-kit-page-actions',
    `vobs-kit-page-actions--${readProp<KitPageActionsAlign>(props, 'align', 'end')}`
  ])
  bindCommonAttributes(root, props, ['align'])
  bindUserStyle(root, props)
  // 同 filter-bar：作者传了 role 就用作者的，没给才兜底（原来无条件写死把它盖掉）
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'group')
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
