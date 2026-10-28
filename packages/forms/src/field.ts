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
 * Read numeric semantics out of passthrough props. Returns `null` means "this is not a numeric input".
 *
 * Detection: `type="number"`, or the caller explicitly gave `min`/`max`/`step`/`precision`
 * — the latter three already indicate the box has numeric semantics (even without type=number).
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
  // Same passthrough set as the component branch: everything except the 5 fields the framework
  // consumes goes to the input element as-is.
  // Previously `extra` was only passed through in the component branch (:34); the default input
  // branch passed none — so `<Field type="password" placeholder="…">` silently rendered a
  // type="text" box showing plain text.
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
      // Passthrough: `type` / `placeholder` / `name` / `autocomplete` / `required` / `aria-*` … all via the attribute channel.
      // Keys whose value is undefined do not become attributes (a false `<input required={cond}>`
      // must not leave `required="undefined"` behind).
      for (const [key, value] of Object.entries(extra)) {
        if (value === undefined) continue
        // onNumberInvalid is our own callback; it must not land as a DOM attribute
        if (key === 'onNumberInvalid') continue
        setAttribute(input, key, String(value))
      }
      // Value sync: null/undefined must not be written into `input.value` (otherwise the literal
      // "undefined" shows up in the box; same intent as the null/undefined guard in bind.ts —
      // `useForm({ nickname: undefined })` did exactly that)
      /*
       * Numeric input goes through the **parsing contract** (external pitfall doc #7).
       *
       * `Number('') === 0`: the instant the user clears the box, the value is written into the
       * signal as 0; in "ratio locking / linked calculation" chains that 0 becomes `Infinity`
       * through division and zeroes the sibling dimensions too — **clearing one input box zeroes
       * several neighboring ones as well**.
       *
       * So for `type="number"` (or a numerically semantic box with explicit `min`/`max`/`step`):
       * empty, invalid, and out-of-bounds values are **not committed**; the signal keeps the last
       * valid value. Other types still write the string as-is (text/password semantics unchanged).
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
          // parse failure → not committed (previous value kept). Callers wanting a hint use onNumberInvalid.
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
