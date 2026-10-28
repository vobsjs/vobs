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
  /** Semantic tone (e.g. income=success / expense=danger); defaults to following the selected state. */
  readonly tone?: SegmentedTone
}

/**
 * Shortcut option form (2026-10-28, cures the "Seg's value = option label"
 * pitfall):
 * - string = `{ id: s, label: s }` (selection writes back that string —
 *   compatible with the existing string facade)
 * - SegmentedItem separates id and label, and selection **writes back the id**
 *   rather than the display label —
 *   `opts={[{id:'login', label:'登录'}]}` gives onChange `'login'`
 */
export type SegmentedOption = string | SegmentedItem

export interface SegmentedProps extends VuiCommonProps {
  /** Shortcut form: strings pass through / objects separate id from label (mutually exclusive with items; items wins). */
  readonly opts?: readonly SegmentedOption[]
  readonly items?: readonly SegmentedItem[]
  /** Controlled current value (mutually exclusive with bind; bind wins). */
  readonly value?: string
  /** Two-way bound signal: selection writes back; external changes sync the highlight. */
  readonly bind?: Signal<string>
  readonly onChange?: (id: string) => void
}

/** Segmented selector: mutually exclusive single choice (unlike Tabs' page semantics); the selected item gets the brand background. */
export function Segmented(props: SegmentedProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-seg'])
  bindCommonAttributes(root, props, ['opts', 'items', 'value', 'bind', 'onChange'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'radiogroup')
  insertDynamic(root, null, () => createSegmentedOptions(props))
  return root
}

function resolveOptions(props: SegmentedProps): readonly SegmentedItem[] {
  const items = readProp<readonly SegmentedItem[] | undefined>(props, 'items', undefined)
  if (items !== undefined) return items
  const opts = readProp<readonly SegmentedOption[] | undefined>(props, 'opts', undefined)
  if (opts === undefined) return []
  return opts.map(option => typeof option === 'string' ? { id: option, label: option } : option)
}

function createSegmentedOptions(props: SegmentedProps): VobsNode {
  const items = resolveOptions(props)
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
