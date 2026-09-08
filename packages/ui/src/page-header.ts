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
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface PageHeaderProps extends VuiCommonProps {
  readonly title?: string
  readonly subtitle?: string
  readonly actions?: VuiChildren
}

export function PageHeader(props: PageHeaderProps = {}): VobsNode {
  const root = createElement('header')
  const main = createElement('div')
  bindClassList(root, props, () => ['vui-pagehead'])
  bindCommonAttributes(root, props, ['title', 'subtitle', 'actions'])
  bindUserStyle(root, props)

  setAttribute(main, 'class', 'vui-pagehead__main')
  if (hasProp(props, 'title')) {
    const title = createElement('h1')
    const text = createText('')
    setAttribute(title, 'class', 'vui-pagehead__title')
    bindTextContent(text, () => readProp(props, 'title', ''))
    insertBefore(title, text, null)
    insertBefore(main, title, null)
  }
  if (hasProp(props, 'subtitle')) {
    const subtitle = createElement('p')
    const text = createText('')
    setAttribute(subtitle, 'class', 'vui-pagehead__subtitle')
    bindTextContent(text, () => readProp(props, 'subtitle', ''))
    insertBefore(subtitle, text, null)
    insertBefore(main, subtitle, null)
  }
  if (hasProp(props, 'children')) mountSlot(main, props, 'children')
  insertBefore(root, main, null)

  if (hasProp(props, 'actions')) {
    const actions = createElement('div')
    setAttribute(actions, 'class', 'vui-pagehead__actions')
    mountSlot(actions, props, 'actions')
    insertBefore(root, actions, null)
  }
  return root
}

export interface PageHeaderActionProps extends VuiCommonProps {
  readonly href?: string
  readonly primary?: boolean
  readonly disabled?: boolean
  readonly onClick?: (event: MouseEvent) => void
}

export function PageHeaderAction(props: PageHeaderActionProps = {}): VobsNode {
  const root = createElement(props.href === undefined ? 'button' : 'a')
  bindClassList(root, props, () => [
    'vui-pagehead__btn',
    readProp(props, 'primary', false) ? 'is-primary' : undefined
  ])
  bindCommonAttributes(root, props, ['href', 'primary', 'disabled', 'onClick'])
  if (props.href === undefined) setAttribute(root, 'type', 'button')
  else setAttribute(root, 'href', props.href)
  effect(() => {
    const disabled = readProp(props, 'disabled', false)
    setOptionalAttribute(root, 'aria-disabled', disabled ? 'true' : undefined)
    if (props.href === undefined) setProperty(root, 'disabled', disabled)
  })
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')

  addEventListener(root, 'click', event => {
    if (readProp(props, 'disabled', false)) {
      event.preventDefault?.()
      return
    }
    const handler = readProp<unknown>(props, 'onClick', undefined)
    if (typeof handler === 'function') (handler as PageHeaderActionProps['onClick'])!(event as MouseEvent)
  })
  return root
}
