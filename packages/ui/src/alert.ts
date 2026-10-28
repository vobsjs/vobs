import {
  createElement,
  createText,
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
import type { VuiCommonProps } from './types'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

export interface AlertProps extends VuiCommonProps {
  readonly tone?: AlertTone
  readonly title?: string
  readonly description?: string
  readonly icon?: VobsNode | (() => VobsNode | null | undefined)
}

export function Alert(props: AlertProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vui-alert',
    `vui-alert--${readProp<AlertTone>(props, 'tone', 'info')}`
  ])
  bindCommonAttributes(root, props, ['tone', 'title', 'description', 'icon'])
  bindUserStyle(root, props)
  /*
   * `role` is a fallback, not an unconditional hardcode.
   *
   * `role` used to be in the skip list of the line above and then hard-coded
   * to 'alert' here — an author writing `<Alert role="status">` was **silently
   * swallowed** (verified: role="alert" came out). Now the author's value wins
   * when given (role already flows through bindCommonAttributes' generic
   * channel); the alert fallback applies only when absent.
   */
  if (!hasProp(props, 'role')) setAttribute(root, 'role', 'alert')

  if (hasProp(props, 'icon')) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-alert__icon')
    mountSlot(icon, props, 'icon')
    insertBefore(root, icon, null)
  }

  const content = createElement('div')
  if (hasProp(props, 'title')) {
    const title = createElement('div')
    const text = createText('')
    setAttribute(title, 'class', 'vui-alert__title')
    bindTextContent(text, () => readProp(props, 'title', ''))
    insertBefore(title, text, null)
    insertBefore(content, title, null)
  }
  if (hasProp(props, 'description')) {
    const description = createElement('div')
    const text = createText('')
    setAttribute(description, 'class', 'vui-alert__desc')
    bindTextContent(text, () => readProp(props, 'description', ''))
    insertBefore(description, text, null)
    insertBefore(content, description, null)
  }
  if (hasProp(props, 'children')) mountSlot(content, props, 'children')
  insertBefore(root, content, null)
  return root
}
