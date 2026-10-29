import { describe, expect, it, vi } from 'vitest'
import { effect } from '@vobs/reactivity'
import { createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import {
  FORMS_KEY,
  type FormsClient,
  type FormOptions,
  formsPlugin,
  Field,
  rules,
  useForm
} from './index'

async function nextMicrotask(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('@vobs/forms', () => {
  it('fields update independently, maintaining dirty, touched, and values', async () => {
    const form = useForm({ name: '', email: '' })
    const name = form.field('name')
    const email = form.field('email')
    let nameRuns = 0
    let emailRuns = 0

    effect(() => {
      void name.value.value
      nameRuns++
    })
    effect(() => {
      void email.value.value
      emailRuns++
    })

    name.set('Alice')
    await nextMicrotask()

    expect(nameRuns).toBe(2)
    expect(emailRuns).toBe(1)
    expect(name.dirty.value).toBe(true)
    expect(form.dirty.value).toBe(true)
    expect(form.values.name).toBe('Alice')
    expect(Object.keys(form.values)).toEqual(['name', 'email'])

    name.markTouched()
    expect(name.touched.value).toBe(true)
    expect(form.touched.value).toEqual(new Set(['name']))
    expect(email.dirty.value).toBe(false)
    form.dispose()
  })

  it('sync validation supports multiple rules, cross-field validation, and aggregate errors', () => {
    const form = useForm({ name: '', password: 'a', confirm: 'b' }, {
      validators: {
        name: [rules.required, rules.minLength(2)],
        confirm: (value, values) => value === values.password ? null : 'Passwords do not match'
      }
    })

    expect(form.validateField('name')).toBe('Required')
    expect(form.field('name').error.value).toBe('Required')
    expect(form.validateField('confirm')).toBe('Passwords do not match')
    expect(form.validateAll()).toEqual({ name: 'Required', confirm: 'Passwords do not match' })
    expect(form.hasErrors.value).toBe(true)
    expect(form.getErrorFields()).toEqual(['name', 'confirm'])
    form.dispose()
  })

  it('async validation commits only the latest result', async () => {
    const resolvers: Array<(message: string | null) => void> = []
    const form = useForm({ email: '' }, {
      validators: {
        email: value => new Promise<string | null>(resolve => {
          resolvers.push(() => resolve(value === 'old' ? 'stale error' : null))
        })
      }
    })
    const email = form.field('email')

    email.set('old')
    const first = email.validate()
    email.set('new')
    const second = email.validate()
    expect(form.validating.value).toBe(true)
    expect(resolvers).toHaveLength(2)
    resolvers[1](null)
    await second
    resolvers[0]('stale error')
    await first

    expect(email.error.value).toBeNull()
    expect(form.validating.value).toBe(false)
    expect(form.validatingFields.value.size).toBe(0)
    form.dispose()
  })

  it('validates on blur and auto-clears after server error backfill', () => {
    const form = useForm({ email: '' }, {
      validateOn: 'blur',
      validators: { email: rules.email }
    })
    const email = form.field('email')

    email.set('invalid')
    expect(email.error.value).toBeNull()
    email.markTouched()
    expect(email.error.value).toBe('Invalid email format')

    form.setServerErrors({ email: 'Email already registered' })
    expect(email.error.value).toBe('Email already registered')
    email.set('valid@example.com')
    expect(email.error.value).toBeNull()
    form.dispose()
  })

  it('validates everything before submit, submits on success, and ignores concurrent submits', async () => {
    const submit = vi.fn(async (values: Readonly<{ name: string }>) => values.name)
    const form = useForm({ name: '' }, {
      validators: { name: rules.required },
      onSubmit: submit
    })

    const invalid = await form.submit()
    expect(invalid).toEqual({ valid: false, errors: { name: 'Required' } })
    expect(submit).not.toHaveBeenCalled()

    form.field('name').set('Alice')
    const first = form.submit()
    const second = form.submit()
    expect(first).toBe(second)
    await expect(first).resolves.toEqual({ valid: true, values: { name: 'Alice' }, result: 'Alice' })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(form.submitting.value).toBe(false)
    form.dispose()
  })

  it('the schema adapter can return async field errors', async () => {
    const form = useForm({ name: 'x' }, {
      schema: {
        validate: async values => values.name.length < 2 ? { name: 'At least 2 characters' } : {}
      }
    })

    await expect(form.validateField('name')).resolves.toBe('At least 2 characters')
    expect(form.errors.value).toEqual({ name: 'At least 2 characters' })
    form.dispose()
  })

  it('form-level errors thrown by the schema join error aggregation and the submit decision', () => {
    const form = useForm({ name: 'Alice' }, {
      schema: {
        validate: () => { throw new Error('Form-level validation failed') }
      }
    })

    expect(form.validateAll()).toEqual({ __form: 'Form-level validation failed' })
    expect(form.errors.value).toEqual({ __form: 'Form-level validation failed' })
    expect(form.hasErrors.value).toBe(true)
    expect(form.getErrorFields()).toEqual([])
    form.clearErrors('__form')
    expect(form.hasErrors.value).toBe(false)
    form.dispose()
  })

  it('resetting fields and the form cancels stale validation state', () => {
    const form = useForm({ name: '' })
    const name = form.field('name')
    name.set('Alice')
    name.markTouched()
    form.setServerErrors({ name: 'Server error' })
    form.reset()

    expect(form.values.name).toBe('')
    expect(name.dirty.value).toBe(false)
    expect(name.touched.value).toBe(false)
    expect(name.error.value).toBeNull()
    expect(form.dirty.value).toBe(false)
    expect(form.touched.value.size).toBe(0)
    form.dispose()
  })

  it('field and form reset set the passed value as the new dirty baseline', () => {
    const form = useForm({ name: '' })
    const name = form.field('name')

    name.set('Alice')
    name.reset('Bob')
    expect(form.values.name).toBe('Bob')
    expect(name.dirty.value).toBe(false)
    name.set('Alice')
    expect(name.dirty.value).toBe(true)

    form.reset({ name: 'Carol' })
    expect(form.values.name).toBe('Carol')
    expect(name.dirty.value).toBe(false)
    name.set('Bob')
    expect(form.dirty.value).toBe(true)
    form.dispose()
  })

  it('formsPlugin provides FormsClient to the app plugin context', () => {
    const client: FormsClient = {
      createForm<T extends object>(initialValues: T, options?: FormOptions<T>) {
        return useForm(initialValues, options)
      }
    }
    let injected: unknown
    const app = createVobs({
      render: () => createText('forms'),
      plugins: [
        formsPlugin({ client }),
        {
          name: 'forms-consumer',
          install(context) {
            injected = context.inject(FORMS_KEY)
          }
        }
      ]
    })

    expect(injected).toBe(client)
    app.destroy()
  })

  it('supports dynamic field add/remove, syncing the field set, values, and error aggregation', () => {
    const form = useForm({ name: '' })
    const fields = form.addField('phone', '', { validators: rules.required })

    expect(form.fieldNames.value).toEqual(new Set(['name', 'phone']))
    expect((form.values as Readonly<Record<string, unknown>>).phone).toBe('')
    expect(fields.validate()).toBe('Required')
    expect(form.errors.value).toEqual({ phone: 'Required' })

    expect(form.removeField('phone')).toBe(true)
    expect(form.removeField('phone')).toBe(false)
    expect(form.fieldNames.value).toEqual(new Set(['name']))
    expect((form.values as Readonly<Record<string, unknown>>).phone).toBeUndefined()
    expect(form.errors.value).toEqual({})
    form.dispose()
  })

  it('async validation supports debouncing and aborts the old AbortSignal when a new validation starts', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      const validator = vi.fn((_value: unknown, _values: Readonly<{ email: string }>, signal?: AbortSignal) => {
        signals.push(signal!)
        return Promise.resolve(null)
      })
      const form = useForm({ email: '' }, {
        validateDebounce: 100,
        validateOn: 'input',
        validators: { email: validator }
      })
      const email = form.field('email')

      const first = email.validate()
      email.set('new')
      const second = email.validate()
      await vi.advanceTimersByTimeAsync(99)
      expect(validator).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await second
      await first

      expect(validator).toHaveBeenCalledTimes(1)
      expect(signals[0].aborted).toBe(false)
      form.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a new async validation run aborts the old one and keeps only the latest result', async () => {
    const signals: AbortSignal[] = []
    const resolvers: Array<(message: string | null) => void> = []
    const form = useForm({ email: '' }, {
      validators: {
        email: (_value, _values, signal) => new Promise<string | null>(resolve => {
          signals.push(signal!)
          resolvers.push(resolve)
          signal?.addEventListener('abort', () => resolve(null), { once: true })
        })
      }
    })

    const first = form.field('email').validate()
    const second = form.field('email').validate()
    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    resolvers[1](null)
    await expect(second).resolves.toBeNull()
    await expect(first).resolves.toBeNull()
    expect(form.validating.value).toBe(false)
    form.dispose()
  })

  it('the official Field provides a default input, label, error display, and two-way value binding', async () => {
    setRenderer(createDOMRenderer())
    const form = useForm({ name: '' }, { validateOn: 'blur', validators: { name: rules.required } })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => Field({ form, name: 'name', label: 'Name' })
    })
    app.mount(container)

    const input = container.querySelector('input') as HTMLInputElement
    expect(container.querySelector('label')?.textContent).toBe('Name')
    input.value = 'Alice'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(form.values.name).toBe('Alice')

    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    await nextMicrotask()
    expect(container.querySelector('[data-vobs-field-error]')?.textContent).toBe('Required')
    app.destroy()
    form.dispose()
  })
})
