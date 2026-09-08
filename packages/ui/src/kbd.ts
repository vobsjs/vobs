import {
  createElement,
  createFragment,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface KbdProps extends VuiCommonProps {}

export function Kbd(props: KbdProps = {}): VobsNode {
  const root = createElement('kbd')
  bindClassList(root, props, () => ['vui-kbd'])
  bindCommonAttributes(root, props)
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export interface KbdComboProps extends VuiCommonProps {
  readonly keys?: readonly VuiChildren[]
  readonly separator?: VuiChildren
}

export function KbdCombo(props: KbdComboProps = {}): VobsNode {
  const root = createElement('span')
  bindClassList(root, props, () => ['vui-kbd__combo'])
  bindCommonAttributes(root, props, ['keys', 'separator'])
  bindUserStyle(root, props)
  if (hasProp(props, 'keys')) insertDynamic(root, null, () => createComboKeys(props))
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export interface KbdRowProps extends VuiCommonProps {}

export function KbdRow(props: KbdRowProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-kbd__row'])
  bindCommonAttributes(root, props)
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createComboKeys(props: KbdComboProps): VobsNode {
  const keys = readProp<readonly VuiChildren[]>(props, 'keys', [])
  const separator = readProp<VuiChildren>(props, 'separator', '+')
  return createFragment((parent, anchor) => {
    for (let index = 0; index < keys.length; index++) {
      if (index > 0) {
        const plus = createElement('span')
        setAttribute(plus, 'class', 'vui-kbd__plus')
        const separatorNode = resolveSlot(separator)
        if (separatorNode) insertBefore(plus, separatorNode, null)
        insertBefore(parent, plus, anchor)
      }
      insertBefore(parent, Kbd({ children: keys[index] }), anchor)
    }
  })
}
