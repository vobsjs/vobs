import {
  createElement,
  insertBefore,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import { effect } from '@vobs/reactivity'
import {
  bindClassList,
  bindCommonAttributes,
  bindPropertyValue,
  bindUserStyle,
  hasProp,
  listen,
  mountSlot,
  readProp,
  setOptionalProperty
} from './utils'
import type { Signal } from '@vobs/reactivity'
import type { VuiCommonProps } from './types'

export interface NumberInputProps extends VuiCommonProps {
  /** 受控当前值（与 bind 二选一；bind 优先） */
  readonly value?: number
  readonly bind?: Signal<number>
  readonly min?: number
  readonly max?: number
  readonly step?: number
  /** 后缀单位（如「天」） */
  readonly suffix?: string
  readonly disabled?: boolean
  readonly onChange?: (value: number) => void
}

/** 数字步进输入：− / + 按钮与键入双向同步，越界自动收敛到 [min, max] */
export function NumberInput(props: NumberInputProps = {}): VobsNode {
  const root = createElement('div')
  const minus = createElement('button')
  const control = createElement('input')
  const plus = createElement('button')

  bindClassList(root, props, () => ['vui-numberinput'])
  bindUserStyle(root, props)
  bindCommonAttributes(root, props, ['value', 'bind', 'min', 'max', 'step', 'suffix', 'disabled', 'onChange'])
  setAttribute(root, 'role', 'group')
  setAttribute(minus, 'type', 'button')
  setAttribute(minus, 'class', 'vui-numberinput__btn')
  setAttribute(minus, 'aria-label', 'Decrease')
  setAttribute(plus, 'type', 'button')
  setAttribute(plus, 'class', 'vui-numberinput__btn')
  setAttribute(plus, 'aria-label', 'Increase')
  minus.textContent = '−'
  plus.textContent = '+'
  setAttribute(control, 'type', 'text')
  setAttribute(control, 'class', 'vui-numberinput__input')
  setAttribute(control, 'inputmode', 'numeric')
  setAttribute(control, 'autocomplete', 'off')

  const bind = bindSignalProp<number>(props)
  const current = (): number => (bind ? bind.value : readProp(props, 'value', 0))
  const clamp = (n: number): number => {
    const min = readProp(props, 'min', 0)
    const max = readProp(props, 'max', 999)
    if (!Number.isFinite(n)) return min
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  effect(() => {
    setOptionalProperty(control, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(minus, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(plus, 'disabled', readProp(props, 'disabled', false))
  })
  if (bind) {
    bindPropertyValue(control, 'value', () => String(bind.value))
  } else if (hasProp(props, 'value')) {
    bindPropertyValue(control, 'value', () => String(current()))
  }

  const commit = (n: number): void => {
    const next = clamp(n)
    if (bind) bind.value = next
    setProperty(control, 'value', String(next))
    props.onChange?.(next)
  }
  const stepSize = (): number => readProp(props, 'step', 1)
  minus.addEventListener('click', () => commit(current() - stepSize()))
  plus.addEventListener('click', () => commit(current() + stepSize()))
  listen(control, 'input', { onInput: (event: Event) => {
    const digits = (event.target as HTMLInputElement).value.replace(/[^\d-]/g, '')
    commit(Number(digits))
  } }, 'onInput', () => readProp(props, 'disabled', false))

  insertBefore(root, minus, null)
  insertBefore(root, control, null)
  insertBefore(root, plus, null)
  if (hasProp(props, 'suffix')) {
    const suffix = createElement('span')
    setAttribute(suffix, 'class', 'vui-numberinput__suffix')
    mountSlot(suffix, props, 'suffix')
    insertBefore(root, suffix, null)
  }
  return root
}

function bindSignalProp<T>(props: object): Signal<T> | undefined {
  const value = readProp<Signal<T> | undefined>(props, 'bind', undefined)
  return value && typeof value === 'object' && 'value' in value ? value : undefined
}
