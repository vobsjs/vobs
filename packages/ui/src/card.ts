import {
  createElement,
  createText,
  insertBefore,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp
} from './utils'
import type { VuiCommonProps } from './types'

export interface CardProps extends VuiCommonProps {
  readonly title?: string
  readonly description?: string
}

export function Card(props: CardProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-card'])
  bindCommonAttributes(root, props, ['title', 'description'])
  bindUserStyle(root, props)

  if (hasProp(props, 'title')) {
    const title = createElement('div')
    const text = createText('')
    setAttribute(title, 'class', 'vui-card__title')
    bindTextContent(text, () => readProp(props, 'title', ''))
    insertBefore(title, text, null)
    insertBefore(root, title, null)
  }
  if (hasProp(props, 'description')) {
    const description = createElement('p')
    const text = createText('')
    setAttribute(description, 'class', 'vui-card__desc')
    bindTextContent(text, () => readProp(props, 'description', ''))
    insertBefore(description, text, null)
    insertBefore(root, description, null)
  }
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export interface CardHeaderProps extends VuiCommonProps {}

export function CardHeader(props: CardHeaderProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-card__header'])
  bindCommonAttributes(root, props)
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
