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
import { parseNumber, type NumberParseFailure, type ParseNumberOptions } from './number'
import type { Form, FormField, FormFieldProps } from './form'

/**
 * 从透传 props 里读出数字语义。返回 `null` 表示"这不是数字输入"。
 *
 * 判定：`type="number"`，或调用方显式给了 `min`/`max`/`step`/`precision`
 * —— 后三者本身就表明这个框是数值语义（即使 type 没写 number）。
 */
function readNumericOptions(
  extra: Record<string, unknown>
): (ParseNumberOptions & { readonly onInvalid?: (reason: NumberParseFailure, text: string) => void }) | null {
  const type = extra.type
  const hasNumericHint = extra.min !== undefined || extra.max !== undefined || extra.step !== undefined
  if (type !== 'number' && !hasNumericHint) return null
  const toNumber = (value: unknown): number | undefined =>
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined
  const min = toNumber(extra.min)
  const max = toNumber(extra.max)
  const integer = extra.step === 1 || extra.step === '1'
  const onInvalid = typeof extra.onNumberInvalid === 'function'
    ? extra.onNumberInvalid as (reason: NumberParseFailure, text: string) => void
    : undefined
  return { min, max, integer, onInvalid }
}

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
        // onNumberInvalid 是我们自己的回调，不能落成 DOM 属性
        if (key === 'onNumberInvalid') continue
        setAttribute(input, key, String(value))
      }
      // 值同步：null/undefined 不能写进 `input.value`（否则字面量 "undefined" 出现在框里，
      // 与 bind.ts 的 null/undefined 守卫同一意图 —— `useForm({ nickname: undefined })` 曾如此）
      /*
       * 数字输入走**解析契约**（外部踩坑文档 #7）。
       *
       * `Number('') === 0`：用户把框清空的瞬间值被当成 0 写进信号，
       * 在「比例锁定 / 联动计算」链路里 `0` 经除法变成 `Infinity`，
       * 再把兄弟维度一并清零 —— **清一个输入框，旁边几个也跟着归零**。
       *
       * 所以 `type="number"`（或显式给了 `min`/`max`/`step` 的数值语义框）时：
       * 空串、非法、超界一律**不提交**，信号保持最后一次有效值。
       * 其余类型仍按原样写字符串（文本框、密码框的语义不变）。
       */
      const numericOptions = readNumericOptions(extra)
      effect(() => {
        const value = field.value.value
        setProperty(input, 'value', value === null || value === undefined ? '' : value)
      })
      addEventListener(input, 'input', event => {
        const text = (event.target as HTMLInputElement).value
        if (numericOptions !== null) {
          const parsed = parseNumber(text, numericOptions)
          // 解析失败 → 不提交（保持原值）。调用方要提示的话看 onNumberInvalid。
          if (!parsed.ok) {
            numericOptions.onInvalid?.(parsed.reason, text)
            return
          }
          field.set(parsed.value as never)
          return
        }
        field.set(text as never)
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
