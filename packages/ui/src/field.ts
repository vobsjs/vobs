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
  /** Field name; a * is appended automatically when required. */
  readonly label?: string
  readonly required?: boolean
  /** Validation error (switches the whole field into the error state and takes precedence over hint). */
  readonly error?: VuiChildren
  /** Supplementary hint (shown when there is no error). */
  readonly hint?: VuiChildren
  readonly children?: VuiChildren
}

/** Form field shell: label + control + error/hint (layout primitive, no interaction). */
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
