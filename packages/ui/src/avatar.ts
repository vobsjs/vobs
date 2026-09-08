import {
  createElement,
  createText,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  readProp,
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type AvatarSize = 'sm' | 'md' | 'lg'
export type AvatarShape = 'circle' | 'square'

export interface AvatarProps extends VuiCommonProps {
  readonly src?: string
  readonly alt?: string
  readonly size?: AvatarSize
  readonly shape?: AvatarShape
  readonly accent?: boolean
  readonly fallback?: VuiChildren
}

export function Avatar(props: AvatarProps = {}): VobsNode {
  const root = createElement('span')
  bindClassList(root, props, () => [
    'vui-avatar',
    readProp<AvatarSize>(props, 'size', 'md') === 'sm' ? 'vui-avatar--sm' : undefined,
    readProp<AvatarSize>(props, 'size', 'md') === 'lg' ? 'vui-avatar--lg' : undefined,
    readProp<AvatarShape>(props, 'shape', 'circle') === 'square' ? 'vui-avatar--square' : undefined,
    readProp(props, 'accent', false) ? 'vui-avatar--accent' : undefined
  ])
  bindCommonAttributes(root, props, ['src', 'alt', 'size', 'shape', 'accent', 'fallback'])
  bindUserStyle(root, props)
  insertDynamic(root, null, () => createAvatarContent(props))
  return root
}

function createAvatarContent(props: AvatarProps): VobsNode | null {
  const src = readProp<string | undefined>(props, 'src', undefined)
  if (src) {
    const image = createElement('img')
    setAttribute(image, 'class', 'vui-avatar__image')
    setAttribute(image, 'src', src)
    setAttribute(image, 'alt', readProp<string>(props, 'alt', ''))
    return image
  }

  if (hasProp(props, 'fallback')) {
    const fallback = resolveSlot(Reflect.get(props, 'fallback'))
    if (fallback) return fallback
  }
  if (hasProp(props, 'children')) {
    const children = resolveSlot(Reflect.get(props, 'children'))
    if (children) return children
  }
  return createText('')
}
