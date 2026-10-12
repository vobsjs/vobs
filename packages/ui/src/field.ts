import {
  createText,
  createElement,
  insertBefore,
  insertDynamic,
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
  readProp,
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface FormFieldProps extends VuiCommonProps {
  /** 字段名；required 时自动追加 * */
  readonly label?: string
  readonly required?: boolean
  /** 校验错误（出现时整体进入错误态，优先于 hint 显示） */
  readonly error?: VuiChildren
  /** 补充提示（无 error 时显示） */
  readonly hint?: VuiChildren
  readonly children?: VuiChildren
}

/** 表单字段壳：标签 + 控件 + 错误/提示（布局原语，不含交互） */
export function FormField(props: FormFieldProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vui-field',
    hasProp(props, 'error') ? 'is-error' : undefined
  ])
  bindCommonAttributes(root, props, ['label', 'required', 'error', 'hint'])
  bindUserStyle(root, props)

  if (hasProp(props, 'label')) {
    const label = createElement('span')
    setAttribute(label, 'class', 'vui-field__label')
    const text = createText('')
    bindTextContent(text, () => {
      const name = readProp(props, 'label', '')
      return readProp(props, 'required', false) ? `${name} *` : name
    })
    insertBefore(label, text, null)
    insertBefore(root, label, null)
  }
  if (hasProp(props, 'children')) {
    const control = createElement('div')
    setAttribute(control, 'class', 'vui-field__control')
    mountSlot(control, props, 'children')
    insertBefore(root, control, null)
  }
  if (hasProp(props, 'error')) {
    const msg = createElement('span')
    setAttribute(msg, 'class', 'vui-field__msg')
    setAttribute(msg, 'data-tone', 'bad')
    insertDynamic(msg, null, () => resolveSlot(Reflect.get(props, 'error')))
    insertBefore(root, msg, null)
  } else if (hasProp(props, 'hint')) {
    const msg = createElement('span')
    setAttribute(msg, 'class', 'vui-field__msg')
    insertDynamic(msg, null, () => resolveSlot(Reflect.get(props, 'hint')))
    insertBefore(root, msg, null)
  }
  return root
}
