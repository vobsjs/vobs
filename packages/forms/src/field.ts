import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createComponent,
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
  // 与 component 分支同一份透传集合：除框架已消费的 5 个字段外，其余原样给输入元素。
  // 此前 `extra` 只在 component 分支（:34）透传，默认 input 分支一个都不透 ——
  // 于是 `<Field type="password" placeholder="…">` 静默渲染成 type="text" 的明文框。
  const { form: _form, name: _name, label: _label, children: _children, component: _component, ...extra } = props

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
    } else if (props.component) {
      const wired = createComponent(props.component, {
        ...extra,
        get value() { return field.value.value as string },
        onInput: (event: Event) => {
          field.set((event.target as HTMLInputElement).value)
        },
        onBlur: () => { void field.markTouched() }
      })
      insertBefore(wrapper, wired, null)
    } else {
      const input = createElement('input')
      // 透传：`type` / `placeholder` / `name` / `autocomplete` / `required` / `aria-*` … 全走属性通道。
      // 值是 undefined 的键不落属性（`<input required={cond}>` 为假时不该留 `required="undefined"`）。
      for (const [key, value] of Object.entries(extra)) {
        if (value === undefined) continue
        setAttribute(input, key, String(value))
      }
      // 值同步：null/undefined 不能写进 `input.value`（否则字面量 "undefined" 出现在框里，
      // 与 bind.ts 的 null/undefined 守卫同一意图 —— `useForm({ nickname: undefined })` 曾如此）
      effect(() => {
        const value = field.value.value
        setProperty(input, 'value', value === null || value === undefined ? '' : value)
      })
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
  return Field({ ...props, form } as FormFieldProps<T>)
}
