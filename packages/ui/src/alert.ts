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
   * `role` 做兜底，而不是无条件写死。
   *
   * 原来 `role` 被放进上面那行的 skip 列表、又在这里硬编码成 'alert' —— 作者写
   * `<Alert role="status">` 会被**静默吞掉**（实测拿到的是 role="alert"）。
   * 现在作者给了就用作者的（role 本来就走 bindCommonAttributes 的通用通道），没给才退回 alert。
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
