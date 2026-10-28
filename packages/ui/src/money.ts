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

/** Thousands separators + fixed decimals (default 2); non-finite numbers fall back to 0 */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return (0).toFixed(decimals)
  return Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

export interface MoneyTextProps extends VuiCommonProps {
  /** Amount (either sign; display uses the absolute value, the sign is decided by kind). */
  readonly value?: number
  /** auto: red parentheses for negatives; in: + green; out: − red; plain: no sign. */
  readonly kind?: MoneyKind
  /** When true, no currency symbol (used when the symbol is already external in tables). */
  readonly plain?: boolean
  /** Currency symbol (default ¥). */
  readonly currency?: string
  readonly decimals?: number
}

/** Amount display: tabular-nums monospace · thousands separators · income green / expense red / red parentheses for negatives. */
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

/** Monospace numeric text (tabular-nums, for aligning numeric columns). */
export function NumText(props: NumTextProps = {}): VobsNode {
  const root = createElement('span')
  bindClassList(root, props, () => ['vui-num'])
  bindCommonAttributes(root, props, [])
  bindUserStyle(root, props)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}
