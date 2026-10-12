import {
  createText,
  createElement,
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
import type { VuiChildren, VuiCommonProps } from './types'

export type MoneyKind = 'auto' | 'in' | 'out' | 'plain'

/** 千分位 + 固定位小数（默认 2 位）；非有限数回落 0 */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return (0).toFixed(decimals)
  return Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

export interface MoneyTextProps extends VuiCommonProps {
  /** 金额（正负皆可；展示取绝对值，符号由 kind 决定） */
  readonly value?: number
  /** auto：负数红括号；in：+ 绿；out：− 红；plain：无符号 */
  readonly kind?: MoneyKind
  /** true 时不显示货币符号（表格里已外置符号时用） */
  readonly plain?: boolean
  /** 货币符号（默认 ¥） */
  readonly currency?: string
  readonly decimals?: number
}

/** 金额展示：等宽 tabular-nums · 千分位 · 收入绿/支出红/负数红括号 */
export function MoneyText(props: MoneyTextProps = {}): VobsNode {
  const root = createElement('span')
  const value = () => readProp(props, 'value', 0)
  const kind = () => readProp<MoneyKind>(props, 'kind', 'auto')
  bindClassList(root, props, () => {
    const k = kind()
    const neg = value() < 0
    let tone = ''
    if (k === 'in') tone = 'is-in'
    else if (k === 'out') tone = 'is-out'
    else if (k === 'auto' && neg) tone = 'is-out'
    return ['vui-money', tone]
  })
  bindCommonAttributes(root, props, ['value', 'kind', 'plain', 'currency', 'decimals'])
  bindUserStyle(root, props)

  if (!readProp(props, 'plain', false)) {
    const currency = createElement('span')
    setAttribute(currency, 'class', 'vui-money__currency')
    const currencyText = createText('')
    bindTextContent(currencyText, () => readProp(props, 'currency', '¥'))
    insertBefore(currency, currencyText, null)
    insertBefore(root, currency, null)
  }
  const amount = createText('')
  bindTextContent(amount, () => {
    const v = value()
    const k = kind()
    const body = formatNumber(v, readProp(props, 'decimals', 2))
    if (k === 'auto' && v < 0) return `(${body})`
    if (k === 'in') return `+${body}`
    if (k === 'out') return `-${body}`
    return body
  })
  insertBefore(root, amount, null)
  return root
}

export interface NumTextProps extends VuiCommonProps {
  readonly children?: VuiChildren
}

/** 等宽数字文本（tabular-nums，数字列对齐用） */
export function NumText(props: NumTextProps = {}): VobsNode {
  const root = createElement('span')
  bindClassList(root, props, () => ['vui-num'])
  bindCommonAttributes(root, props, [])
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
