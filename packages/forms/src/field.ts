import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createElement,
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  setProperty,
  type VobsNode
} from '@vobs/vobs'
import type { Form, FormField, FormFieldProps } from './form'

export function Field<T extends object>(props: FormFieldProps<T>): VobsNode {
  const field = props.form.field(props.name as never) as FormField<unknown>

  return createFragment((parent, anchor) => {
    const wrapper = createElement('div')
    setAttribute(wrapper, 'data-vobs-field', props.name)
    insertBefore(parent, wrapper, anchor)

    if (props.label) {
      const label = createElement('label')
      insertBefore(label, createText(props.label), null)
      insertBefore(wrapper, label, null)
    }

    if (props.children) {
      const child = props.children(field)
      if (child) insertBefore(wrapper, child, null)
    } else {
      const input = createElement('input')
      effect(() => setProperty(input, 'value', field.value.value))
      addEventListener(input, 'input', event => {
        field.set((event.target as HTMLInputElement).value)
      })
      addEventListener(input, 'blur', () => { void field.markTouched() })
      insertBefore(wrapper, input, null)
    }

    insertDynamic(wrapper, null, () => {
      if (!field.touched.value || !field.error.value) return null
      const error = createElement('span')
      setAttribute(error, 'data-vobs-field-error', '')
      insertBefore(error, createText(field.error.value), null)
      return error
    })
  })
}

export function formField<T extends object>(
  form: Form<T>,
  props: Omit<FormFieldProps<T>, 'form'>
): VobsNode {
  return Field({ ...props, form })
}
