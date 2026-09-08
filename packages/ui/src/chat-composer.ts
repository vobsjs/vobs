import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createElement,
  createText,
  insertBefore,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindPropertyValue,
  bindUserStyle,
  hasProp,
  listen,
  mountSlot,
  readProp,
  setOptionalAttribute,
  setOptionalProperty
} from './utils'
import type { VuiChildren, VuiCommonProps, VuiEventHandler } from './types'

export interface ChatComposerProps extends VuiCommonProps {
  readonly value?: string
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly model?: string
  readonly modelIcon?: VuiChildren
  readonly modelChevron?: VuiChildren
  readonly tools?: VuiChildren
  readonly actions?: VuiChildren
  readonly sendIcon?: VuiChildren
  readonly sendLabel?: string
  readonly onInput?: VuiEventHandler<InputEvent>
  readonly onSubmit?: (value: string, event: KeyboardEvent) => void
  readonly onSend?: (value: string, event: MouseEvent) => void
  readonly onModelClick?: (event: MouseEvent) => void
}

export function ChatComposer(props: ChatComposerProps = {}): VobsNode {
  const root = createElement('div')
  const input = createElement('textarea')
  const toolbar = createElement('div')
  const tools = createElement('div')
  const actions = createElement('div')

  bindClassList(root, props, () => ['vui-composer'])
  bindUserStyle(root, props)
  bindCommonAttributes(input, props, [
    'value',
    'placeholder',
    'disabled',
    'model',
    'modelIcon',
    'modelChevron',
    'tools',
    'actions',
    'sendIcon',
    'sendLabel',
    'onInput',
    'onSubmit',
    'onSend',
    'onModelClick'
  ])
  setAttribute(input, 'class', 'vui-composer__input')
  setAttribute(toolbar, 'class', 'vui-composer__toolbar')
  setAttribute(tools, 'class', 'vui-composer__tools')
  setAttribute(actions, 'class', 'vui-composer__actions')

  effect(() => {
    setOptionalAttribute(input, 'placeholder', readProp<string | undefined>(props, 'placeholder', undefined))
    setOptionalProperty(input, 'disabled', readProp(props, 'disabled', false))
    setOptionalAttribute(input, 'aria-disabled', readProp(props, 'disabled', false) ? 'true' : undefined)
  })
  if (hasProp(props, 'value')) {
    bindPropertyValue(input, 'value', () => readProp(props, 'value', '') ?? '')
  }
  listen(input, 'input', props, 'onInput', () => readProp(props, 'disabled', false))
  addEventListener(input, 'keydown', event => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key !== 'Enter' || (!keyboardEvent.metaKey && !keyboardEvent.ctrlKey)) return
    keyboardEvent.preventDefault?.()
    const handler = readProp<unknown>(props, 'onSubmit', undefined)
    if (typeof handler === 'function') (handler as ChatComposerProps['onSubmit'])!(currentValue(input, props), keyboardEvent)
  })

  if (hasProp(props, 'tools')) mountSlot(tools, props, 'tools')
  else if (hasProp(props, 'children')) mountSlot(tools, props, 'children')
  if (hasProp(props, 'model')) insertBefore(tools, createModelSelector(props), null)

  if (hasProp(props, 'actions')) mountSlot(actions, props, 'actions')
  else insertBefore(actions, createSendButton(input, props), null)

  insertBefore(root, input, null)
  insertBefore(toolbar, tools, null)
  insertBefore(toolbar, actions, null)
  insertBefore(root, toolbar, null)
  return root
}

function createModelSelector(props: ChatComposerProps): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', 'vui-composer__model')
  setAttribute(button, 'type', 'button')
  if (hasProp(props, 'modelIcon')) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-composer__model-icon')
    mountSlot(icon, props, 'modelIcon')
    insertBefore(button, icon, null)
  }
  const text = createText('')
  bindTextContent(text, () => readProp(props, 'model', ''))
  insertBefore(button, text, null)
  if (hasProp(props, 'modelChevron')) {
    const chevron = createElement('span')
    setAttribute(chevron, 'class', 'vui-composer__model-chevron')
    mountSlot(chevron, props, 'modelChevron')
    insertBefore(button, chevron, null)
  }
  addEventListener(button, 'click', event => {
    const handler = readProp<unknown>(props, 'onModelClick', undefined)
    if (typeof handler === 'function') (handler as ChatComposerProps['onModelClick'])!(event as MouseEvent)
  })
  return button
}

function createSendButton(input: Element, props: ChatComposerProps): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', 'vui-composer__send')
  setAttribute(button, 'type', 'button')
  const label = readProp(props, 'sendLabel', 'Send')
  setOptionalAttribute(button, 'aria-label', label)
  if (hasProp(props, 'sendIcon')) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-composer__send-icon')
    mountSlot(icon, props, 'sendIcon')
    insertBefore(button, icon, null)
  } else {
    insertBefore(button, createText(label), null)
  }
  effect(() => setProperty(button, 'disabled', readProp(props, 'disabled', false)))
  addEventListener(button, 'click', event => {
    if (readProp(props, 'disabled', false)) return
    const handler = readProp<unknown>(props, 'onSend', undefined)
    if (typeof handler === 'function') (handler as ChatComposerProps['onSend'])!(currentValue(input, props), event as MouseEvent)
  })
  return button
}

function currentValue(input: Element, props: ChatComposerProps): string {
  const value = Reflect.get(input, 'value')
  return typeof value === 'string' ? value : readProp(props, 'value', '') ?? ''
}
