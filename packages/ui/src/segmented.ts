import {
  createFragment,
  createElement,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  readProp,
  resolveSlot,
  setOptionalAttribute
} from './utils'
import type { Signal } from '@vobs/reactivity'
import type { VuiChildren, VuiCommonProps } from './types'

export type SegmentedTone = 'default' | 'brand' | 'success' | 'warning' | 'danger'

export interface SegmentedItem {
  readonly id: string
  readonly label: VuiChildren
  /** 语义色调（如 收入=success / 支出=danger）；缺省跟随选中态 */
  readonly tone?: SegmentedTone
}

export interface SegmentedProps extends VuiCommonProps {
  readonly items?: readonly SegmentedItem[]
  /** 受控当前值（与 bind 二选一；bind 优先） */
  readonly value?: string
  /** 双向绑定信号：选中写回、外部变更同步高亮 */
  readonly bind?: Signal<string>
  readonly onChange?: (id: string) => void
}

/** 分段选择：互斥单选（区别于 Tabs 的页签语义），选中项带品牌底 */
export function Segmented(props: SegmentedProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-seg'])
  bindCommonAttributes(root, props, ['items', 'value', 'bind', 'onChange'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'radiogroup')
  insertDynamic(root, null, () => createSegmentedOptions(props))
  return root
}

function createSegmentedOptions(props: SegmentedProps): VobsNode {
  const items = readProp<readonly SegmentedItem[]>(props, 'items', [])
  const active = currentId(props)
  return createFragment((parent, anchor) => {
    for (const item of items) {
      insertBefore(parent, createSegmentedOption(props, item, active), anchor)
    }
  })
}

function createSegmentedOption(props: SegmentedProps, item: SegmentedItem, active: string): VobsNode {
  const option = createElement('button')
  setAttribute(option, 'type', 'button')
  setAttribute(option, 'role', 'radio')
  setAttribute(option, 'data-id', item.id)
  if (item.tone !== undefined && item.tone !== 'default') {
    setAttribute(option, 'data-tone', item.tone)
  }
  setOptionalAttribute(option, 'aria-checked', active === item.id ? 'true' : undefined)
  setAttribute(option, 'class', active === item.id ? 'vui-seg__opt is-active' : 'vui-seg__opt')
  if (item.label !== undefined) {
    const label = createElement('span')
    setAttribute(label, 'class', 'vui-seg__label')
    const node = resolveSlot(item.label)
    if (node) insertBefore(label, node, null)
    insertBefore(option, label, null)
  }
  option.addEventListener('click', () => selectOption(props, item.id))
  return option
}

function currentId(props: SegmentedProps): string {
  const bind = bindSignalProp<string>(props)
  return bind ? bind.value : readProp(props, 'value', '')
}

function selectOption(props: SegmentedProps, id: string): void {
  const bind = bindSignalProp<string>(props)
  if (bind) bind.value = id
  props.onChange?.(id)
}

function bindSignalProp<T>(props: object): Signal<T> | undefined {
  const value = readProp<Signal<T> | undefined>(props, 'bind', undefined)
  return value && typeof value === 'object' && 'value' in value ? value : undefined
}
