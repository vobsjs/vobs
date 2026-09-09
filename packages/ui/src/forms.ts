import { effect, type Signal } from '@vobs/reactivity'
import {
  createElement,
  insertBefore,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindPropertyValue,
  bindUserStyle,
  hasProp,
  listen,
  mountSlot,
  readProp,
  setOptionalAttribute,
  setOptionalProperty
} from './utils'
import type { VuiCommonProps, VuiEventHandler } from './types'

export type InputType = 'date' | 'email' | 'number' | 'password' | 'search' | 'text' | 'url'

/** bind 传入 Signal 时组件建立双向绑定：信号→DOM property、用户输入→信号写回。 */
function bindSignalProp<T>(props: object): Signal<T> | undefined {
  const value = readProp<Signal<T> | undefined>(props, 'bind', undefined)
  return value && typeof value === 'object' && 'value' in value ? value : undefined
}

export interface InputProps extends VuiCommonProps {
  readonly type?: InputType
  readonly name?: string
  readonly value?: string | number
  readonly bind?: Signal<string | number | undefined>
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly required?: boolean
  readonly icon?: VobsNode | (() => VobsNode | null | undefined)
  readonly onInput?: VuiEventHandler<InputEvent>
  readonly onChange?: VuiEventHandler<Event>
  readonly onBlur?: VuiEventHandler<FocusEvent>
}

export function Input(props: InputProps = {}): VobsNode {
  const root = createElement('div')
  const control = createElement('input')

  bindClassList(root, props, () => [
    'vui-input',
    readProp<InputType>(props, 'type', 'text') === 'search' ? 'vui-search' : undefined
  ])
  bindUserStyle(root, props)
  bindCommonAttributes(control, props, [
    'type',
    'name',
    'value',
    'placeholder',
    'disabled',
    'readOnly',
    'required',
    'icon',
    'onInput',
    'onChange',
    'onBlur'
  ])

  effect(() => {
    setOptionalAttribute(control, 'type', readProp<InputType>(props, 'type', 'text'))
    setOptionalAttribute(control, 'name', readProp<string | undefined>(props, 'name', undefined))
    setOptionalAttribute(control, 'placeholder', readProp<string | undefined>(props, 'placeholder', undefined))
    setOptionalProperty(control, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(control, 'readOnly', readProp(props, 'readOnly', false))
    setOptionalProperty(control, 'required', readProp(props, 'required', false))
  })
  const bind = bindSignalProp<string | number | undefined>(props)
  if (bind) {
    bindPropertyValue(control, 'value', () => String(bind.value ?? ''))
    listen(control, 'input', { onInput: (event: Event) => { bind.value = (event.target as HTMLInputElement).value } }, 'onInput', () => readProp(props, 'disabled', false))
  } else if (hasProp(props, 'value')) {
    bindPropertyValue(control, 'value', () => readProp<string | number | undefined>(props, 'value', undefined) ?? '')
  }

  if (hasProp(props, 'icon')) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-input__icon')
    mountSlot(icon, props, 'icon')
    insertBefore(root, icon, null)
  }
  insertBefore(root, control, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')

  listen(control, 'input', props, 'onInput', () => readProp(props, 'disabled', false))
  listen(control, 'change', props, 'onChange', () => readProp(props, 'disabled', false))
  listen(control, 'blur', props, 'onBlur', () => false)
  return root
}

export interface TextareaProps extends VuiCommonProps {
  readonly value?: string | number
  readonly bind?: Signal<string | number | undefined>
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly required?: boolean
  readonly rows?: number
  readonly name?: string
  readonly onInput?: VuiEventHandler<InputEvent>
  readonly onChange?: VuiEventHandler<Event>
  readonly onBlur?: VuiEventHandler<FocusEvent>
}

export function Textarea(props: TextareaProps = {}): VobsNode {
  const root = createElement('textarea')
  bindClassList(root, props, () => ['vui-textarea'])
  bindCommonAttributes(root, props, [
    'value',
    'placeholder',
    'disabled',
    'readOnly',
    'required',
    'rows',
    'name',
    'onInput',
    'onChange',
    'onBlur'
  ])
  effect(() => {
    setOptionalAttribute(root, 'name', readProp<string | undefined>(props, 'name', undefined))
    setOptionalAttribute(root, 'placeholder', readProp<string | undefined>(props, 'placeholder', undefined))
    setOptionalProperty(root, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(root, 'readOnly', readProp(props, 'readOnly', false))
    setOptionalProperty(root, 'required', readProp(props, 'required', false))
    setOptionalAttribute(root, 'rows', readProp<number | undefined>(props, 'rows', undefined))
  })
  const bind = bindSignalProp<string | number | undefined>(props)
  if (bind) {
    bindPropertyValue(root, 'value', () => String(bind.value ?? ''))
    listen(root, 'input', { onInput: (event: Event) => { bind.value = (event.target as HTMLTextAreaElement).value } }, 'onInput', () => readProp(props, 'disabled', false))
  } else if (hasProp(props, 'value')) {
    bindPropertyValue(root, 'value', () => readProp<string | number | undefined>(props, 'value', undefined) ?? '')
  }
  listen(root, 'input', props, 'onInput', () => readProp(props, 'disabled', false))
  listen(root, 'change', props, 'onChange', () => readProp(props, 'disabled', false))
  listen(root, 'blur', props, 'onBlur', () => false)
  return root
}

export interface SelectProps extends VuiCommonProps {
  readonly name?: string
  readonly value?: string | number
  readonly bind?: Signal<string | number | undefined>
  readonly disabled?: boolean
  readonly required?: boolean
  readonly multiple?: boolean
  readonly size?: number
  readonly onChange?: VuiEventHandler<Event>
}

export function Select(props: SelectProps = {}): VobsNode {
  const root = createElement('select')
  bindClassList(root, props, () => ['vui-select'])
  bindCommonAttributes(root, props, [
    'name',
    'value',
    'disabled',
    'required',
    'multiple',
    'size',
    'onChange'
  ])
  effect(() => {
    setOptionalAttribute(root, 'name', readProp<string | undefined>(props, 'name', undefined))
    setOptionalProperty(root, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(root, 'required', readProp(props, 'required', false))
    setOptionalProperty(root, 'multiple', readProp(props, 'multiple', false))
    setOptionalAttribute(root, 'size', readProp<number | undefined>(props, 'size', undefined))
  })
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  const bind = bindSignalProp<string | number | undefined>(props)
  if (bind) {
    bindPropertyValue(root, 'value', () => String(bind.value ?? ''))
    listen(root, 'change', { onChange: (event: Event) => { bind.value = (event.target as HTMLSelectElement).value } }, 'onChange', () => readProp(props, 'disabled', false))
  } else if (hasProp(props, 'value')) {
    bindPropertyValue(root, 'value', () => readProp<string | number | undefined>(props, 'value', undefined) ?? '')
  }
  listen(root, 'change', props, 'onChange', () => readProp(props, 'disabled', false))
  return root
}

export interface ChoiceProps extends VuiCommonProps {
  readonly name?: string
  readonly value?: string
  readonly checked?: boolean
  readonly bind?: Signal<boolean>
  readonly disabled?: boolean
  readonly required?: boolean
  readonly onChange?: VuiEventHandler<Event>
}

export function Checkbox(props: ChoiceProps = {}): VobsNode {
  return createChoice('checkbox', props)
}

export function Radio(props: ChoiceProps = {}): VobsNode {
  return createChoice('radio', props)
}

function createChoice(type: 'checkbox' | 'radio', props: ChoiceProps): VobsNode {
  const root = createElement('label')
  const control = createElement('input')
  const visual = createElement('span')

  bindClassList(root, props, () => [`vui-${type}`])
  bindUserStyle(root, props)
  bindCommonAttributes(control, props, [
    'name',
    'value',
    'checked',
    'disabled',
    'required',
    'onChange'
  ])
  setAttribute(visual, 'class', type === 'checkbox' ? 'vui-check__box' : 'vui-radio__dot')

  effect(() => {
    setOptionalAttribute(control, 'type', type)
    setOptionalAttribute(control, 'name', readProp<string | undefined>(props, 'name', undefined))
    setOptionalAttribute(control, 'value', readProp<string | undefined>(props, 'value', undefined))
    setOptionalProperty(control, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(control, 'required', readProp(props, 'required', false))
  })
  const bind = bindSignalProp<boolean>(props)
  if (bind) {
    bindPropertyValue(control, 'checked', () => bind.value)
    listen(control, 'change', { onChange: (event: Event) => { bind.value = (event.target as HTMLInputElement).checked } }, 'onChange', () => readProp(props, 'disabled', false))
  } else if (hasProp(props, 'checked')) {
    bindPropertyValue(control, 'checked', () => readProp(props, 'checked', false))
  }
  insertBefore(root, control, null)
  insertBefore(root, visual, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  listen(control, 'change', props, 'onChange', () => readProp(props, 'disabled', false))
  return root
}

export interface SwitchProps extends VuiCommonProps {
  readonly checked?: boolean
  readonly bind?: Signal<boolean>
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly size?: 'sm' | 'md'
  readonly name?: string
  readonly value?: string
  readonly onChange?: VuiEventHandler<Event>
}

export function Switch(props: SwitchProps = {}): VobsNode {
  const root = createElement('label')
  const control = createElement('input')
  const thumb = createElement('span')

  bindClassList(root, props, () => [
    'vui-switch',
    readProp<'sm' | 'md'>(props, 'size', 'md') === 'sm' ? 'vui-switch--sm' : undefined
  ])
  bindUserStyle(root, props)
  bindCommonAttributes(root, props, ['role'])
  bindCommonAttributes(control, props, [
    'checked',
    'disabled',
    'readOnly',
    'name',
    'value',
    'onChange'
  ])
  setAttribute(thumb, 'class', 'vui-switch__thumb')
  setAttribute(root, 'role', 'switch')
  const bind = bindSignalProp<boolean>(props)

  effect(() => {
    setOptionalAttribute(control, 'type', 'checkbox')
    setOptionalAttribute(control, 'name', readProp<string | undefined>(props, 'name', undefined))
    setOptionalAttribute(control, 'value', readProp<string | undefined>(props, 'value', undefined))
    setOptionalProperty(control, 'disabled', readProp(props, 'disabled', false))
    setOptionalProperty(control, 'readOnly', readProp(props, 'readOnly', false))
    setOptionalAttribute(root, 'aria-checked', (bind ? bind.value : readProp(props, 'checked', false)) ? 'true' : 'false')
    setOptionalAttribute(root, 'aria-disabled', readProp(props, 'disabled', false) ? 'true' : undefined)
  })
  if (bind) {
    bindPropertyValue(control, 'checked', () => bind.value)
    listen(control, 'change', { onChange: (event: Event) => { bind.value = (event.target as HTMLInputElement).checked } }, 'onChange', () => readProp(props, 'disabled', false))
  } else if (hasProp(props, 'checked')) {
    bindPropertyValue(control, 'checked', () => readProp(props, 'checked', false))
  }
  insertBefore(root, control, null)
  insertBefore(root, thumb, null)
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  listen(control, 'change', props, 'onChange', () => readProp(props, 'disabled', false))
  return root
}
