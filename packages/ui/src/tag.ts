import {
  createElement,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { VuiCommonProps } from './types'

export type TagTone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'count' | 'neutral-strong'

export interface TagProps extends VuiCommonProps {
  readonly tone?: TagTone
}

export function Tag(props: TagProps = {}): VobsNode {
  const root = createElement('span')
  bindClassList(root, props, () => [
    'vui-tag',
    readProp<TagTone>(props, 'tone', 'default') === 'default'
      ? undefined
      : `vui-tag--${readProp<TagTone>(props, 'tone', 'default')}`
  ])
  bindCommonAttributes(root, props, ['tone'])
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
