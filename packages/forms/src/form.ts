import { createOwner, state, type Signal } from '@vobs/reactivity'
import type { VobsNode } from '@vobs/vobs'
import { Field } from './field'

export type FormFieldName<T extends object> = Extract<keyof T, string>
export type ValidationTrigger = 'input' | 'blur' | 'submit' | 'manual'
export type ValidationResult = string | null | undefined | void
export type ValidationOutput = string | null | Promise<string | null>

export type Validator<TValue, TValues extends object> = (
  value: TValue,
  values: Readonly<TValues>,
  signal?: AbortSignal
) => ValidationResult | PromiseLike<ValidationResult>

export type ValidatorMap<T extends object> = Partial<{
  [K in FormFieldName<T>]: Validator<T[K], T> | readonly Validator<T[K], T>[]
}>

export type FormErrorName<T extends object> = FormFieldName<T> | '__form'
export type FormErrors<T extends object> = Partial<Record<FormErrorName<T>, string>>

export interface SchemaAdapter<T extends object> {
  validate(values: Readonly<T>): FormErrors<T> | PromiseLike<FormErrors<T>>
}

export type SubmitHandler<T extends object, TResult = unknown> = (
  values: Readonly<T>
) => TResult | PromiseLike<TResult>

export interface FormOptions<T extends object> {
  validators?: ValidatorMap<T>
  schema?: SchemaAdapter<T>
  validateOn?: ValidationTrigger
  validateDebounce?: number | Partial<Record<FormFieldName<T>, number>>
  onSubmit?: SubmitHandler<T>
}

export interface DynamicFieldOptions<T extends object, TValue = unknown> {
  validators?: Validator<TValue, T> | readonly Validator<TValue, T>[]
  validateDebounce?: number
}

export interface FormField<T> {
  readonly name: string
  readonly value: Signal<T>
  readonly touched: Signal<boolean>
  readonly dirty: Signal<boolean>
  readonly error: Signal<string | null>
  readonly validating: Signal<boolean>
  set(value: T): void
  markTouched(): ValidationOutput
  validate(): ValidationOutput
  reset(value?: T): void
}

export interface SubmitSuccess<T extends object, TResult = unknown> {
  readonly valid: true
  readonly values: Readonly<T>
  readonly result: TResult | undefined
}

export interface SubmitFailure<T extends object> {
  readonly valid: false
  readonly errors: FormErrors<T>
}

export type SubmitResult<T extends object, TResult = unknown> =
  | SubmitSuccess<T, TResult>
  | SubmitFailure<T>

export interface Form<T extends object> {
  readonly values: Readonly<T>
  readonly dirty: Signal<boolean>
  readonly touched: Signal<ReadonlySet<FormFieldName<T>>>
  readonly errors: Signal<Readonly<FormErrors<T>>>
  readonly hasErrors: Signal<boolean>
  readonly submitting: Signal<boolean>
  readonly validating: Signal<boolean>
  readonly validatingFields: Signal<ReadonlySet<FormFieldName<T>>>
  readonly fieldNames: Signal<ReadonlySet<string>>
  readonly Field: FormFieldComponent<T>
  field<K extends FormFieldName<T>>(name: K): FormField<T[K]>
  addField<TValue>(name: string, initialValue: TValue, options?: DynamicFieldOptions<T, TValue>): FormField<TValue>
  removeField(name: string): boolean
  validateField<K extends FormFieldName<T>>(name: K): ValidationOutput
  validateAll(): FormErrors<T> | Promise<FormErrors<T>>
  setServerErrors(errors: Partial<Record<FormErrorName<T>, string | null | undefined>>): void
  clearErrors(name?: FormErrorName<T>): void
  getErrorFields(): FormFieldName<T>[]
  submit<TResult = unknown>(handler?: SubmitHandler<T, TResult>): Promise<SubmitResult<T, TResult>>
  reset(values?: Partial<T>): void
  dispose(): void
}

export interface FormFieldComponent<T extends object> {
  (props: FormFieldProps<T>): VobsNode
}

export interface FormFieldProps<T extends object> {
  form: Form<T>
  name: string
  label?: string
  children?: (field: FormField<unknown>) => VobsNode
}

interface InternalField<TValue, TValues extends object> {
  readonly name: string
  readonly value: Signal<TValue>
  readonly touched: Signal<boolean>
  readonly dirty: Signal<boolean>
  readonly error: Signal<string | null>
  readonly validating: Signal<boolean>
  initialValue: TValue
  validationRun: number
  validators?: readonly Validator<unknown, TValues>[]
  validateDebounce?: number
  controller?: AbortController
  debounceTimer?: ReturnType<typeof setTimeout>
  debounceCancel?: () => void
}

const FORM_DISPOSED = 'Vobs forms: 表单已销毁'

export function useForm<T extends object>(initialValues: T, options: FormOptions<T> = {}): Form<T> {
  return createForm(initialValues, options)
}

export function createForm<T extends object>(initialValues: T, options: FormOptions<T> = {}): Form<T> {
  const owner = createOwner()
  const names = Object.keys(initialValues)
  const fields = new Map<string, InternalField<unknown, T>>()
  const touchedNames = new Set<FormFieldName<T>>()
  const validatingNames = new Set<FormFieldName<T>>()
  const dirty = owner.run(() => state(false))
  const touched = owner.run(() => state<ReadonlySet<FormFieldName<T>>>(new Set()))
  const errors = owner.run(() => state<Readonly<FormErrors<T>>>({} as FormErrors<T>))
  const hasErrors = owner.run(() => state(false))
  const submitting = owner.run(() => state(false))
  const validating = owner.run(() => state(false))
  const validatingFields = owner.run(() => state<ReadonlySet<FormFieldName<T>>>(new Set()))
  const fieldNames = owner.run(() => state<ReadonlySet<string>>(new Set(names)))
  let schemaRun = 0
  let schemaPending = 0
  let formError: string | null = null
  let disposed = false
  let submitPromise: Promise<SubmitResult<T, unknown>> | null = null

  owner.run(() => {
    for (const name of names) {
      const initialValue = initialValues[name as FormFieldName<T>]
      fields.set(name, {
        name,
        value: state(initialValue),
        touched: state(false),
        dirty: state(false),
        error: state<string | null>(null),
        validating: state(false),
        initialValue,
        validationRun: 0
      })
    }
  })

  const values = createValuesProxy<T>(fields)

  function assertActive(): void {
    if (disposed) throw new Error(FORM_DISPOSED)
  }

  function getInternalField(name: string): InternalField<unknown, T> {
    const field = fields.get(name)
    if (!field) throw new Error(`Vobs forms: 未定义字段 "${name}"`)
    return field
  }

  function updateAggregateErrors(): void {
    const next: FormErrors<T> = {}
    if (formError) next.__form = formError
    for (const name of names) {
      const error = fields.get(name)!.error.value
      if (error) next[name as FormErrorName<T>] = error
    }
    errors.value = next
    hasErrors.value = Object.keys(next).length > 0
  }

  function setFieldError(name: string, message: string | null): void {
    const field = getInternalField(name)
    field.error.value = message
    updateAggregateErrors()
  }

  function setFormError(message: string | null): void {
    formError = message
    updateAggregateErrors()
  }

  function updateDirty(): void {
    dirty.value = names.some(name => fields.get(name)!.dirty.value)
  }

  function updateValidating(): void {
    validating.value = validatingNames.size > 0 || schemaPending > 0
  }

  function setFieldValidating(name: string, active: boolean): void {
    const field = getInternalField(name)
    field.validating.value = active
    const typedName = name as FormFieldName<T>
    if (active) validatingNames.add(typedName)
    else validatingNames.delete(typedName)
    validatingFields.value = new Set(validatingNames)
    updateValidating()
  }

  function normalizeMessage(value: unknown): string | null {
    if (value === undefined || value === null || value === '' || value === false) return null
    if (value instanceof Error) return value.message || '校验失败'
    return String(value)
  }

  function validatorList(name: string): readonly Validator<unknown, T>[] {
    const field = fields.get(name)
    if (field?.validators) return field.validators
    const configured = options.validators?.[name as FormFieldName<T>] as
      | Validator<unknown, T>
      | readonly Validator<unknown, T>[]
      | undefined
    if (!configured) return []
    return (Array.isArray(configured) ? configured : [configured]) as readonly Validator<unknown, T>[]
  }

  function runValidators(name: string, value: unknown, snapshot: Readonly<T>, signal: AbortSignal): ValidationOutput {
    const validators = validatorList(name)
    let index = 0

    const next = (): ValidationOutput => {
      while (index < validators.length) {
        const validator = validators[index++]
        let result: ValidationResult | PromiseLike<ValidationResult>
        try {
          result = validator(value, snapshot, signal)
        } catch (error) {
          if (signal.aborted) return null
          return normalizeMessage(error) ?? '校验失败'
        }
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            message => normalizeMessage(message) ?? next(),
            error => signal.aborted ? null : normalizeMessage(error) ?? '校验失败'
          )
        }
        const message = normalizeMessage(result)
        if (message) return message
      }
      return null
    }

    return next()
  }

  function runSchema(snapshot: Readonly<T>): FormErrors<T> | Promise<FormErrors<T>> {
    if (!options.schema) return {}
    try {
      const result = options.schema.validate(snapshot)
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(normalizeErrors, error => ({
          __form: normalizeMessage(error) ?? '校验失败'
        } as FormErrors<T>))
      }
      return normalizeErrors(result)
    } catch (error) {
      return { __form: normalizeMessage(error) ?? '校验失败' } as FormErrors<T>
    }
  }

  function normalizeErrors(value: unknown): FormErrors<T> {
    if (!value || typeof value !== 'object') return {}
    const result: FormErrors<T> = {}
    for (const [name, message] of Object.entries(value)) {
      const normalized = normalizeMessage(message)
      if (normalized) result[name as FormFieldName<T>] = normalized
    }
    return result
  }

  function applyValidation(name: string, run: number, result: unknown): string | null {
    const field = fields.get(name)
    const message = normalizeMessage(result)
    if (!disposed && field && field.validationRun === run) setFieldError(name, message)
    return message
  }

  function debounceFor(name: string, field: InternalField<unknown, T>): number {
    if (field.validateDebounce !== undefined) return field.validateDebounce
    if (typeof options.validateDebounce === 'number') return options.validateDebounce
    return options.validateDebounce?.[name as FormFieldName<T>] ?? 0
  }

  function cancelFieldValidation(field: InternalField<unknown, T>): void {
    field.validationRun++
    field.controller?.abort()
    field.controller = undefined
    if (field.debounceCancel) field.debounceCancel()
    if (field.debounceTimer !== undefined) clearTimeout(field.debounceTimer)
    field.debounceTimer = undefined
    field.debounceCancel = undefined
  }

  function beginFieldValidation(field: InternalField<unknown, T>): AbortController {
    field.controller?.abort()
    if (field.debounceCancel) field.debounceCancel()
    if (field.debounceTimer !== undefined) clearTimeout(field.debounceTimer)
    field.debounceCancel = undefined
    const controller = new AbortController()
    field.controller = controller
    return controller
  }

  function validateFieldInternal(name: string, includeSchema: boolean): ValidationOutput {
    assertActive()
    const field = getInternalField(name)
    const run = ++field.validationRun
    const controller = beginFieldValidation(field)
    const snapshot = snapshotValues<T>(fields)
    const execute = (): ValidationOutput => runValidators(name, field.value.value, snapshot, controller.signal)
    const delay = debounceFor(name, field)
    const fieldResult = delay > 0
      ? new Promise<ValidationResult>(resolve => {
          field.debounceCancel = () => resolve(null)
          field.debounceTimer = setTimeout(() => {
            field.debounceTimer = undefined
            field.debounceCancel = undefined
            resolve(execute())
          }, delay)
        })
      : execute()

    const finish = (message: unknown): ValidationOutput => {
      if (!includeSchema || !options.schema) return applyValidation(name, run, message)
      const schemaResult = runSchema(snapshot)
      if (isPromiseLike(schemaResult)) {
        schemaPending++
        updateValidating()
        return Promise.resolve(schemaResult).then(schemaErrors => {
          const schemaMessage = schemaErrors[name as FormFieldName<T>]
          setFormError(schemaErrors.__form ?? null)
          return applyValidation(name, run, schemaMessage ?? message)
        }).finally(() => {
          schemaPending--
          updateValidating()
        }) as Promise<string | null>
      }
      setFormError(schemaResult.__form ?? null)
      return applyValidation(name, run, schemaResult[name as FormFieldName<T>] ?? message)
    }

    if (isPromiseLike(fieldResult)) {
      setFieldValidating(name, true)
      return Promise.resolve(fieldResult).then(finish).finally(() => {
        if (!disposed && field.validationRun === run) {
          field.controller = undefined
          field.debounceCancel = undefined
          setFieldValidating(name, false)
        }
      }) as Promise<string | null>
    }
    field.controller = undefined
    field.debounceCancel = undefined
    if (!disposed && field.validationRun === run) setFieldValidating(name, false)
    return finish(fieldResult)
  }

  function validateField(name: FormFieldName<T>): ValidationOutput {
    return validateFieldInternal(name, true)
  }

  function applyAllErrors(fieldErrors: FormErrors<T>, schemaErrors: FormErrors<T>): FormErrors<T> {
    const result: FormErrors<T> = {}
    setFormError(schemaErrors.__form ?? null)
    if (schemaErrors.__form) result.__form = schemaErrors.__form
    for (const name of names) {
      const errorName = name as FormErrorName<T>
      const message = schemaErrors[errorName] ?? fieldErrors[errorName] ?? null
      setFieldError(name, message)
      if (message) result[errorName] = message
    }
    return result
  }

  function validateAll(): FormErrors<T> | Promise<FormErrors<T>> {
    assertActive()
    for (const name of names) {
      const field = fields.get(name)!
      field.touched.value = true
      touchedNames.add(name as FormFieldName<T>)
    }
    touched.value = new Set(touchedNames)

    const currentSchemaRun = ++schemaRun
    const fieldResults = names.map(name => validateFieldInternal(name, false))
    const schemaResult = options.schema ? runSchema(snapshotValues<T>(fields)) : {}
    const combine = (fieldMessages: readonly (string | null)[], schemaErrors: FormErrors<T>): FormErrors<T> => {
      if (currentSchemaRun !== schemaRun) return {}
      const fieldErrors: FormErrors<T> = {}
      names.forEach((name, index) => {
        if (fieldMessages[index]) fieldErrors[name as FormErrorName<T>] = fieldMessages[index]!
      })
      return applyAllErrors(fieldErrors, schemaErrors)
    }

    if (fieldResults.some(isPromiseLike) || isPromiseLike(schemaResult)) {
      if (isPromiseLike(schemaResult)) {
        schemaPending++
        updateValidating()
      }
      return Promise.all(fieldResults.map(result => Promise.resolve(result))).then(fieldMessages => {
        if (isPromiseLike(schemaResult)) {
          return Promise.resolve(schemaResult).then(schemaErrors => combine(fieldMessages, schemaErrors as FormErrors<T>))
        }
        return combine(fieldMessages, schemaResult)
      }).finally(() => {
        if (isPromiseLike(schemaResult)) {
          schemaPending--
          updateValidating()
        }
      }).then(result => result as FormErrors<T>)
    }

    return combine(fieldResults as string[], schemaResult as FormErrors<T>)
  }

  function fieldApi<K extends FormFieldName<T>>(name: K): FormField<T[K]> {
    const field = getInternalField(name)
    return {
      name,
      value: field.value as Signal<T[K]>,
      touched: field.touched,
      dirty: field.dirty,
      error: field.error,
      validating: field.validating,
      set(value: T[K]): void {
        assertActive()
        const nextValue = value
        field.value.value = nextValue
        field.dirty.value = !Object.is(nextValue, field.initialValue)
        field.error.value = null
        updateAggregateErrors()
        updateDirty()
        if (options.validateOn === 'input') void settle(validateField(name))
      },
      markTouched(): ValidationOutput {
        assertActive()
        field.touched.value = true
        touchedNames.add(name)
        touched.value = new Set(touchedNames)
        return options.validateOn === 'blur' ? validateField(name) : null
      },
      validate(): ValidationOutput {
        return validateField(name)
      },
      reset(value?: T[K]): void {
        assertActive()
        cancelFieldValidation(field)
        setFieldValidating(name, false)
        const nextValue = arguments.length === 0 ? field.initialValue : value as T[K]
        field.initialValue = nextValue
        field.value.value = nextValue
        field.dirty.value = false
        field.touched.value = false
        touchedNames.delete(name)
        field.error.value = null
        touched.value = new Set(touchedNames)
        updateAggregateErrors()
        updateDirty()
      }
    }
  }

  function addField<TValue>(name: string, initialValue: TValue, fieldOptions: DynamicFieldOptions<T, TValue> = {}): FormField<TValue> {
    assertActive()
    if (!name) throw new Error('Vobs forms: 字段名不能为空')
    if (fields.has(name)) throw new Error(`Vobs forms: 字段 "${name}" 已存在`)
    const validators = fieldOptions.validators
      ? (Array.isArray(fieldOptions.validators) ? fieldOptions.validators : [fieldOptions.validators]) as readonly Validator<unknown, T>[]
      : undefined
    fields.set(name, {
      name,
      value: state(initialValue),
      touched: state(false),
      dirty: state(false),
      error: state<string | null>(null),
      validating: state(false),
      initialValue,
      validationRun: 0,
      validators,
      validateDebounce: fieldOptions.validateDebounce
    })
    names.push(name)
    fieldNames.value = new Set(names)
    return fieldApi(name as FormFieldName<T>) as unknown as FormField<TValue>
  }

  function removeField(name: string): boolean {
    assertActive()
    const field = fields.get(name)
    if (!field) return false
    cancelFieldValidation(field)
    setFieldValidating(name, false)
    fields.delete(name)
    const index = names.indexOf(name)
    if (index >= 0) names.splice(index, 1)
    touchedNames.delete(name as FormFieldName<T>)
    fieldNames.value = new Set(names)
    touched.value = new Set(touchedNames)
    updateAggregateErrors()
    updateDirty()
    return true
  }

  function setServerErrors(serverErrors: Partial<Record<FormErrorName<T>, string | null | undefined>>): void {
    assertActive()
    for (const [name, message] of Object.entries(serverErrors)) {
      if (name === '__form') {
        setFormError(normalizeMessage(message))
        continue
      }
      if (!fields.has(name)) continue
      setFieldError(name, normalizeMessage(message))
    }
  }

  function clearErrors(name?: FormErrorName<T>): void {
    assertActive()
    if (name === '__form') {
      setFormError(null)
      return
    }
    const targets = (name ? [name] : names) as string[]
    for (const target of targets) {
      const field = getInternalField(target)
      cancelFieldValidation(field)
      setFieldValidating(target, false)
      field.error.value = null
    }
    if (!name) setFormError(null)
    updateAggregateErrors()
  }

  function getErrorFields(): FormFieldName<T>[] {
    return names.filter(name => Boolean(fields.get(name)!.error.value)) as FormFieldName<T>[]
  }

  function reset(nextValues: Partial<T> = {}): void {
    assertActive()
    schemaRun++
    setFormError(null)
    for (const name of names) {
      const field = getInternalField(name)
      cancelFieldValidation(field)
      setFieldValidating(name, false)
      const nextValue = Object.prototype.hasOwnProperty.call(nextValues, name)
        ? nextValues[name as FormFieldName<T>]
        : field.initialValue
      field.initialValue = nextValue as unknown
      field.value.value = nextValue
      field.dirty.value = false
      field.touched.value = false
      field.error.value = null
    }
    touchedNames.clear()
    touched.value = new Set()
    updateAggregateErrors()
    updateDirty()
  }

  function submit<TResult = unknown>(handler?: SubmitHandler<T, TResult>): Promise<SubmitResult<T, TResult>> {
    assertActive()
    if (submitPromise) return submitPromise as Promise<SubmitResult<T, TResult>>
    const submitHandler = handler ?? options.onSubmit as SubmitHandler<T, TResult> | undefined
    const run = async (): Promise<SubmitResult<T, TResult>> => {
      submitting.value = true
      try {
        const validationErrors = await validateAll()
        if (Object.keys(validationErrors).length > 0) {
          return { valid: false, errors: validationErrors }
        }
        const snapshot = snapshotValues<T>(fields)
        const result = submitHandler ? await submitHandler(snapshot) : undefined
        return { valid: true, values: snapshot, result }
      } finally {
        submitting.value = false
      }
    }
    const pending = run().finally(() => { submitPromise = null })
    submitPromise = pending as Promise<SubmitResult<T, unknown>>
    return pending
  }

  owner.onDispose(() => {
    for (const field of fields.values()) cancelFieldValidation(field)
    disposed = true
    fields.clear()
    touchedNames.clear()
    validatingNames.clear()
  })

  const api = {
    values,
    dirty,
    touched,
    errors,
    hasErrors,
    submitting,
    validating,
    validatingFields,
    fieldNames,
    Field: (props: Omit<FormFieldProps<T>, 'form'>) => Field({ ...props, form: api }),
    field: fieldApi,
    addField,
    removeField,
    validateField,
    validateAll,
    setServerErrors,
    clearErrors,
    getErrorFields,
    submit,
    reset,
    dispose(): void {
      if (!disposed) owner.dispose()
    }
  } as Form<T>

  return api
}

function snapshotValues<T extends object>(fields: Map<string, InternalField<unknown, T>>): T {
  const snapshot: Record<string, unknown> = {}
  for (const [name, field] of fields) snapshot[name] = field.value.value
  return snapshot as T
}

function createValuesProxy<T extends object>(fields: Map<string, InternalField<unknown, T>>): Readonly<T> {
  return new Proxy({} as T, {
    get(_target, property: string | symbol): unknown {
      if (typeof property !== 'string') return undefined
      return fields.get(property)?.value.value
    },
    set(): boolean {
      throw new Error('Vobs forms: values 不能直接赋值，请使用 field(name).set(value)')
    },
    has(_target, property: string | symbol): boolean {
      return typeof property === 'string' && fields.has(property)
    },
    ownKeys(): string[] {
      return [...fields.keys()]
    },
    getOwnPropertyDescriptor(_target, property: string | symbol): PropertyDescriptor | undefined {
      if (typeof property !== 'string' || !fields.has(property)) return undefined
      return { enumerable: true, configurable: true }
    }
  })
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<T>).then === 'function'
}

function settle(value: ValidationOutput): Promise<void> {
  return isPromiseLike(value) ? Promise.resolve(value).then(() => undefined) : Promise.resolve()
}
