import { createElement, insertBefore, setAttribute, type VobsNode } from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot
} from './utils'
import type { LayoutChildren, LayoutCommonProps } from '@vobs/layout'

export interface KitToolbarBarProps extends LayoutCommonProps {
  /** Filter/search controls (left zone; wraps when fluid). */
  readonly left?: LayoutChildren
  /** Primary action buttons (right zone; pinned to the end). */
  readonly right?: LayoutChildren
}

/**
 * Headless toolbar strip: the first thing a page body renders. Left zone holds
 * filters/search, right zone holds primary actions. `flex: none` — it stays put
 * while the table panel below scrolls. Spacing against neighbouring blocks is
 * the parent layout's business (KitPage already provides the gap).
 */
export function KitToolbarBar(props: KitToolbarBarProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vobs-kit-toolbar-bar'])
  bindCommonAttributes(root, props, ['left', 'right'])
  bindUserStyle(root, props)
  if (hasProp(props, 'left')) {
    const left = createElement('div')
    setAttribute(left, 'class', 'vobs-kit-toolbar-bar__left')
    mountSlot(left, props, 'left')
    insertBefore(root, left, null)
  }
  if (hasProp(props, 'right')) {
    const right = createElement('div')
    setAttribute(right, 'class', 'vobs-kit-toolbar-bar__right')
    mountSlot(right, props, 'right')
    insertBefore(root, right, null)
  }
  return root
}
