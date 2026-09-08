import { effect } from '@vobs/reactivity'
import {
  createElement,
  createText,
  insertBefore,
  insertDynamic,
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
  readProp,
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type StatDeltaDirection = 'up' | 'down'

export interface StatCardProps extends VuiCommonProps {
  readonly label?: string
  readonly value?: VuiChildren
  readonly delta?: VuiChildren
  readonly deltaDirection?: StatDeltaDirection
  readonly deltaIcon?: VuiChildren
  readonly deltaCaption?: VuiChildren
}

export function StatCard(props: StatCardProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-statcard'])
  bindCommonAttributes(root, props, [
    'label',
    'value',
    'delta',
    'deltaDirection',
    'deltaIcon',
    'deltaCaption'
  ])
  bindUserStyle(root, props)

  if (hasProp(props, 'label')) {
    const label = createElement('span')
    const text = createText('')
    setAttribute(label, 'class', 'vui-statcard__label')
    bindTextContent(text, () => readProp(props, 'label', ''))
    insertBefore(label, text, null)
    insertBefore(root, label, null)
  }

  if (hasProp(props, 'value')) {
    const value = createElement('span')
    setAttribute(value, 'class', 'vui-statcard__value')
    insertDynamic(value, null, () => resolveSlot(Reflect.get(props, 'value')))
    insertBefore(root, value, null)
  }

  if (hasProp(props, 'delta') || hasProp(props, 'deltaIcon') || hasProp(props, 'deltaCaption')) {
    const delta = createElement('span')
    effect(() => {
      const direction = readProp<StatDeltaDirection | undefined>(props, 'deltaDirection', undefined)
      setAttribute(delta, 'class', `vui-statcard__delta${direction ? ` is-${direction}` : ''}`)
    })
    if (hasProp(props, 'deltaIcon')) mountSlot(delta, props, 'deltaIcon')
    if (hasProp(props, 'delta')) mountSlot(delta, props, 'delta')
    if (hasProp(props, 'deltaCaption')) {
      const caption = createElement('span')
      setAttribute(caption, 'class', 'vui-statcard__caption')
      mountSlot(caption, props, 'deltaCaption')
      insertBefore(delta, caption, null)
    }
    insertBefore(root, delta, null)
  }

  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export interface StatCardGridProps extends VuiCommonProps {}

export function StatCardGrid(props: StatCardGridProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-statcard__grid'])
  bindCommonAttributes(root, props)
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
