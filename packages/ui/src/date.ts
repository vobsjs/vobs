import { onDispose } from '@vobs/vobs'
import {
  addEventListener,
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
  readProp,
  setOptionalAttribute,
  setOptionalProperty
} from './utils'
import type { Signal } from '@vobs/reactivity'
import type { VuiCommonProps } from './types'

const pad2 = (n: number): string => String(n).padStart(2, '0')

const CHEVRON_LEFT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'

export interface MonthPickerProps extends VuiCommonProps {
  /** 受控月份（YYYY-MM；与 bind 二选一；bind 优先） */
  readonly value?: string
  readonly bind?: Signal<string>
  readonly onChange?: (value: string) => void
  /** 前翻月按钮的无障碍名 */
  readonly previousLabel?: string
  /** 后翻月按钮的无障碍名 */
  readonly nextLabel?: string
  readonly disabled?: boolean
}

/** 月份步进选择（‹ YYYY-MM ›） */
export function MonthPicker(props: MonthPickerProps = {}): VobsNode {
  const root = createElement('div')
  const previous = createElement('button')
  const text = createText('')
  const next = createElement('button')

  bindClassList(root, props, () => ['vui-monthpicker'])
  bindCommonAttributes(root, props, ['value', 'bind', 'onChange', 'previousLabel', 'nextLabel', 'disabled'])
  bindUserStyle(root, props)
  const bind = bindSignalProp<string>(props)
  const current = (): string => (bind ? bind.value : readProp(props, 'value', ''))
  const disabled = (): boolean => readProp(props, 'disabled', false)

  setAttribute(previous, 'type', 'button')
  setAttribute(previous, 'class', 'vui-monthpicker__btn')
  setAttribute(previous, 'aria-label', readProp(props, 'previousLabel', 'Previous month'))
  previous.innerHTML = CHEVRON_LEFT
  setAttribute(next, 'type', 'button')
  setAttribute(next, 'class', 'vui-monthpicker__btn')
  setAttribute(next, 'aria-label', readProp(props, 'nextLabel', 'Next month'))
  next.innerHTML = CHEVRON_RIGHT
  setAttribute(root, 'role', 'group')

  bindTextContent(text, () => current())
  const syncDisabled = (): void => {
    setOptionalProperty(previous, 'disabled', disabled() || undefined)
    setOptionalProperty(next, 'disabled', disabled() || undefined)
  }
  syncDisabled()

  const shift = (delta: number): void => {
    if (disabled()) return
    const [y, m] = current().split('-').map(Number)
    const base = Number.isFinite(y) && Number.isFinite(m) ? y * 12 + (m - 1) : 0
    const total = base + delta
    const value = `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`
    if (bind) bind.value = value
    props.onChange?.(value)
  }
  addEventListener(previous, 'click', () => shift(-1))
  addEventListener(next, 'click', () => shift(1))

  insertBefore(root, previous, null)
  insertBefore(root, text, null)
  insertBefore(root, next, null)
  return root
}

export interface DateRangePanelProps extends VuiCommonProps {
  /** 起始日期（YYYY-MM-DD；'' 表示未选） */
  readonly start?: string
  /** 结束日期（'' 表示未选完） */
  readonly end?: string
  /** 选点回调：第一击写 start，第二击按先后归位 (start, end) */
  readonly onChange: (start: string, end: string) => void
  /** 星期表头（可本地化；默认「日一二三四五六」） */
  readonly weekdayLabels?: readonly string[]
}

/** 双月日历面板（范围选择；受控组件，start/end 变化由调用方重建） */
export function DateRangePanel(props: DateRangePanelProps): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-daterange-panel'])
  bindCommonAttributes(root, props, ['start', 'end', 'onChange', 'weekdayLabels'])
  bindUserStyle(root, props)

  const today = new Date()
  const base = { y: today.getFullYear(), m: today.getMonth() }
  const hover = { value: '' }
  const pick = (day: string): void => {
    const start: string = readProp(props, 'start', '')
    const end: string = readProp(props, 'end', '')
    if (start === '' || end !== '') {
      props.onChange(day, '')
      return
    }
    if (day < start) props.onChange(day, start)
    else props.onChange(start, day)
  }
  const rebuild = (): void => {
    root.replaceChildren(buildPanel(props, base, hover, () => rebuild, pick))
  }
  rebuild()
  return root
}

function buildPanel(
  props: DateRangePanelProps,
  base: { y: number; m: number },
  hover: { value: string },
  onShift: (delta: number) => void,
  pick: (day: string) => void
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const weekdays = readProp<readonly string[]>(props, 'weekdayLabels', ['日', '一', '二', '三', '四', '五', '六'])
  const second = base.m === 11 ? { y: base.y + 1, m: 0 } : { y: base.y, m: base.m + 1 }

  const head = createElement('div')
  setAttribute(head, 'class', 'vui-daterange-panel__head')
  const previous = createElement('button')
  setAttribute(previous, 'type', 'button')
  setAttribute(previous, 'class', 'vui-monthpicker__btn')
  setAttribute(previous, 'aria-label', 'Previous month')
  previous.innerHTML = CHEVRON_LEFT
  const next = createElement('button')
  setAttribute(next, 'type', 'button')
  setAttribute(next, 'class', 'vui-monthpicker__btn')
  setAttribute(next, 'aria-label', 'Next month')
  next.innerHTML = CHEVRON_RIGHT
  const ym = createElement('span')
  setAttribute(ym, 'class', 'vui-daterange-panel__ym')
  ym.textContent = `${base.y}-${pad2(base.m + 1)} ~ ${second.y}-${pad2(second.m + 1)}`
  previous.addEventListener('click', () => onShift(-1))
  next.addEventListener('click', () => onShift(1))
  head.appendChild(previous)
  head.appendChild(ym)
  head.appendChild(next)
  fragment.appendChild(head)

  const body = createElement('div')
  setAttribute(body, 'class', 'vui-daterange-panel__body')
  body.addEventListener('mouseleave', () => {
    hover.value = ''
  })
  for (const month of [base, second]) {
    insertBefore(body, buildMonthGrid(props, month, hover, weekdays, pick), null)
  }
  fragment.appendChild(body)
  return fragment
}

function buildMonthGrid(
  props: DateRangePanelProps,
  month: { y: number; m: number },
  hover: { value: string },
  weekdays: readonly string[],
  pick: (day: string) => void
): VobsNode {
  const grid = createElement('div')
  setAttribute(grid, 'class', 'vui-daterange-panel__grid')

  const week = createElement('div')
  setAttribute(week, 'class', 'vui-daterange-panel__week')
  for (const d of weekdays) {
    const cell = createElement('span')
    cell.textContent = d
    week.appendChild(cell)
  }
  grid.appendChild(week)

  const days = createElement('div')
  setAttribute(days, 'class', 'vui-daterange-panel__days')
  const first = new Date(month.y, month.m, 1).getDay()
  const dayCount = new Date(month.y, month.m + 1, 0).getDate()
  for (let i = 0; i < first; i++) {
    days.appendChild(createElement('span'))
  }
  for (let d = 1; d <= dayCount; d++) {
    const stamp = `${month.y}-${pad2(month.m + 1)}-${pad2(d)}`
    const day = createElement('button')
    setAttribute(day, 'type', 'button')
    setAttribute(day, 'data-stamp', stamp)
    day.textContent = String(d)
    day.addEventListener('mouseenter', () => {
      hover.value = stamp
    })
    day.addEventListener('click', () => pick(stamp))
    days.appendChild(day)
  }
  // 悬停预览/选中范围的高亮统一在 build 后刷一遍（面板整体重建成本可接受）
  const paint = (): void => {
    const s: string = readProp(props, 'start', '')
    const e: string = readProp(props, 'end', '') || hover.value || ''
    const lo: string = s !== '' && e !== '' ? (s < e ? s : e) : s
    const hi: string = s !== '' && e !== '' ? (s < e ? e : s) : s
    for (const node of days.querySelectorAll<HTMLButtonElement>('.vui-daterange-panel__day')) {
      const stamp = node.getAttribute('data-stamp') ?? ''
      const edge = stamp === lo || stamp === hi
      const mid = lo !== '' && hi !== '' && stamp > lo && stamp < hi
      setAttribute(node, 'class', `vui-daterange-panel__day${edge ? ' is-edge' : mid ? ' is-mid' : ''}`)
      setOptionalAttribute(node, 'data-current', stamp === s ? 'true' : undefined)
    }
  }
  paint()
  for (const node of days.querySelectorAll<HTMLButtonElement>('.vui-daterange-panel__day')) {
    node.addEventListener('mouseenter', () => paint())
  }
  grid.appendChild(days)
  return grid
}

export interface DateRangeProps extends VuiCommonProps {
  /** 受控起始日期（与 bindStart 二选一） */
  readonly start?: string
  /** 受控结束日期（与 bindEnd 二选一） */
  readonly end?: string
  readonly bindStart?: Signal<string>
  readonly bindEnd?: Signal<string>
  readonly disabled?: boolean
  /** 触发器占位文案 */
  readonly placeholder?: string
  /** 面板宽度（数字按 px，默认 420） */
  readonly panelWidth?: number
  readonly onChange?: (start: string, end: string) => void
}

/** 范围日期选择（触发器 + 弹出双月面板；点击外部收起） */
export function DateRange(props: DateRangeProps = {}): VobsNode {
  const root = createElement('div')
  const trigger = createElement('button')
  const popup = createElement('div')

  bindClassList(root, props, () => ['vui-daterange'])
  bindCommonAttributes(root, props, ['start', 'end', 'bindStart', 'bindEnd', 'disabled', 'placeholder', 'panelWidth', 'onChange'])
  bindUserStyle(root, props)
  const startBind = bindSignalProp<string>(props, 'bindStart')
  const endBind = bindSignalProp<string>(props, 'bindEnd')
  const startOf = (): string => (startBind ? startBind.value : readProp(props, 'start', ''))
  const endOf = (): string => (endBind ? endBind.value : readProp(props, 'end', ''))
  const open = { value: false }

  setAttribute(trigger, 'type', 'button')
  setAttribute(trigger, 'class', 'vui-daterange__trigger')
  const label = createText('')
  bindTextContent(label, () => {
    const a = startOf()
    const b = endOf()
    if (a === '') return readProp(props, 'placeholder', '开始日期 ~ 结束日期')
    return `${a} ~ ${b === '' ? '…' : b}`
  })
  insertBefore(trigger, label, null)
  const syncDisabled = (): void => {
    setOptionalProperty(trigger, 'disabled', readProp(props, 'disabled', false) || undefined)
  }
  syncDisabled()
  trigger.addEventListener('click', () => {
    if (readProp(props, 'disabled', false)) return
    open.value = !open.value
    syncPopup()
  })

  setAttribute(popup, 'class', 'vui-daterange__pop')
  function syncPopup(): void {
    if (open.value) {
      setAttribute(root, 'data-open', 'true')
      popup.replaceChildren()
      insertBefore(popup, DateRangePanel({
        get start() { return startOf() },
        get end() { return endOf() },
        onChange: (a, b) => {
          if (startBind) startBind.value = a
          if (endBind) endBind.value = b
          props.onChange?.(a, b)
          if (b !== '') {
            open.value = false
            syncPopup()
          }
        }
      }), null)
      setAttribute(popup, 'style', `width:${readProp(props, 'panelWidth', 420)}px`)
      if (popup.parentElement === null) root.appendChild(popup)
    } else {
      setAttribute(root, 'data-open', 'false')
      popup.remove()
    }
  }
  // 点击外部收起（随组件 dispose 清理）
  {
    const handler = (event: MouseEvent): void => {
      if (open.value && event.target instanceof Node && !root.contains(event.target)) {
        open.value = false
        syncPopup()
      }
    }
    document.addEventListener('mousedown', handler)
    onDispose(() => document.removeEventListener('mousedown', handler))
  }

  insertBefore(root, trigger, null)
  return root
}

function bindSignalProp<T>(props: object, key = 'bind'): Signal<T> | undefined {
  const value = readProp<Signal<T> | undefined>(props, key, undefined)
  return value && typeof value === 'object' && 'value' in value ? value : undefined
}
