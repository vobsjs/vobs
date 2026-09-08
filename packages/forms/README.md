# @vobs/forms

Signal-based form state for vobs: per-field `dirty`/`touched`/`error` tracking, async validation with debounce and `AbortSignal` cancellation, schema adapters, and deduplicated submits.

## Install

```bash
npm install @vobs/forms
```

## Quick start

```ts
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Field, rules, useForm } from '@vobs/forms'

setRenderer(createDOMRenderer())

const form = useForm({ email: '' }, {
  validators: { email: [rules.required, rules.email] },
  validateOn: 'blur'
})

const app = createVobs({
  render: () => Field({ form, name: 'email', label: 'Email' })
})

app.mount(document.getElementById('app')!)
```

`Field` renders a label, an `<input>` bound to the field value (or a custom control via the `children(field)` render prop), and the error message once the field is touched. Server-side errors set through `form.setServerErrors()` are cleared automatically when that field changes.

## API

| Signature | Description |
| --- | --- |
| `useForm<T>(initialValues: T, options?: FormOptions<T>): Form<T>` | Creates a form. Options: `validators` (`ValidatorMap`, sync or async, supports cross-field access to `values`), `validateOn` (`'input' \| 'blur' \| 'submit' \| 'manual'`), `validateDebounce` in milliseconds, `schema` (`SchemaAdapter`), `onSubmit`. |
| `form.field(name)` | `FormField` with signal-based `value`, `error`, `dirty`, `touched`, plus `set()`, `markTouched()`, `validate()`, and `reset(nextValue?)` (the passed value becomes the new dirty baseline). |
| `form.validateField(name)` / `form.validateAll()` | Run validators and return the error map; async validation only ever applies the latest call. |
| `form.submit()` | Validates everything first and ignores concurrent calls (they share one promise). Resolves with `{ valid: true, values, result }` on success or `{ valid: false, errors }` when validation fails. |
| `form.setServerErrors(errors)` | Backfills errors that clear on the next change of the field. |
| `form.addField(name, value, options?)` / `form.removeField(name)` | Dynamic field collections; `fieldNames`, values, and the error aggregate stay in sync. |
| `form.reset(values?)` | Restores values and cancels stale validation state for all fields. |
| `Field(props: FormFieldProps)` | Label + input (or `children(field)`) + error message, wired to `form.field(name)`. |
| `rules` | Built-in validators: `required`, `email`, `minLength(n)`, `maxLength(n)`, `min(n)`, `max(n)`, `pattern(regex, message)`. |
| `formsPlugin(options?)` / `FORMS_KEY` | App plugin providing a `FormsClient` so consumers can `inject(FORMS_KEY).createForm(...)`. |

Async validators receive an `AbortSignal` that is aborted whenever a newer validation starts, and with `validateDebounce` the call is delayed until the input settles.

## Types

DynamicFieldOptions, Form, FormErrorName, FormErrors, FormField, FormFieldComponent, FormFieldProps, FormFieldName, FormOptions, SchemaAdapter, SubmitFailure, SubmitHandler, SubmitResult, SubmitSuccess, ValidationOutput, ValidationResult, ValidationTrigger, Validator, ValidatorMap, FormsClient, FormsPluginOptions
