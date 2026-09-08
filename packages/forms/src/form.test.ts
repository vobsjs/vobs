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
  it('字段独立更新，并维护 dirty、touched 和 values', async () => {
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

  it('同步校验支持多规则、跨字段校验和全量错误', () => {
    const form = useForm({ name: '', password: 'a', confirm: 'b' }, {
      validators: {
        name: [rules.required, rules.minLength(2)],
        confirm: (value, values) => value === values.password ? null : '两次密码不一致'
      }
    })

    expect(form.validateField('name')).toBe('必填')
    expect(form.field('name').error.value).toBe('必填')
    expect(form.validateField('confirm')).toBe('两次密码不一致')
    expect(form.validateAll()).toEqual({ name: '必填', confirm: '两次密码不一致' })
    expect(form.hasErrors.value).toBe(true)
    expect(form.getErrorFields()).toEqual(['name', 'confirm'])
    form.dispose()
  })

  it('异步校验只提交最新一次结果', async () => {
    const resolvers: Array<(message: string | null) => void> = []
    const form = useForm({ email: '' }, {
      validators: {
        email: value => new Promise<string | null>(resolve => {
          resolvers.push(() => resolve(value === 'old' ? '旧错误' : null))
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
    resolvers[0]('旧错误')
    await first

    expect(email.error.value).toBeNull()
    expect(form.validating.value).toBe(false)
    expect(form.validatingFields.value.size).toBe(0)
    form.dispose()
  })

  it('按照 blur 触发校验，并支持服务端错误回填后自动清除', () => {
    const form = useForm({ email: '' }, {
      validateOn: 'blur',
      validators: { email: rules.email }
    })
    const email = form.field('email')

    email.set('invalid')
    expect(email.error.value).toBeNull()
    email.markTouched()
    expect(email.error.value).toBe('邮箱格式错误')

    form.setServerErrors({ email: '邮箱已被注册' })
    expect(email.error.value).toBe('邮箱已被注册')
    email.set('valid@example.com')
    expect(email.error.value).toBeNull()
    form.dispose()
  })

  it('提交前全量校验，成功提交，并忽略并发提交', async () => {
    const submit = vi.fn(async (values: Readonly<{ name: string }>) => values.name)
    const form = useForm({ name: '' }, {
      validators: { name: rules.required },
      onSubmit: submit
    })

    const invalid = await form.submit()
    expect(invalid).toEqual({ valid: false, errors: { name: '必填' } })
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

  it('schema 适配器可以返回异步字段错误', async () => {
    const form = useForm({ name: 'x' }, {
      schema: {
        validate: async values => values.name.length < 2 ? { name: '至少 2 个字符' } : {}
      }
    })

    await expect(form.validateField('name')).resolves.toBe('至少 2 个字符')
    expect(form.errors.value).toEqual({ name: '至少 2 个字符' })
    form.dispose()
  })

  it('schema 抛出的表单级错误会参与错误聚合和提交判定', () => {
    const form = useForm({ name: 'Alice' }, {
      schema: {
        validate: () => { throw new Error('整表校验失败') }
      }
    })

    expect(form.validateAll()).toEqual({ __form: '整表校验失败' })
    expect(form.errors.value).toEqual({ __form: '整表校验失败' })
    expect(form.hasErrors.value).toBe(true)
    expect(form.getErrorFields()).toEqual([])
    form.clearErrors('__form')
    expect(form.hasErrors.value).toBe(false)
    form.dispose()
  })

  it('重置字段和表单会取消过期校验状态', () => {
    const form = useForm({ name: '' })
    const name = form.field('name')
    name.set('Alice')
    name.markTouched()
    form.setServerErrors({ name: '服务端错误' })
    form.reset()

    expect(form.values.name).toBe('')
    expect(name.dirty.value).toBe(false)
    expect(name.touched.value).toBe(false)
    expect(name.error.value).toBeNull()
    expect(form.dirty.value).toBe(false)
    expect(form.touched.value.size).toBe(0)
    form.dispose()
  })

  it('字段和表单 reset 会把传入值设为新的 dirty 基线', () => {
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

  it('formsPlugin 向应用插件提供 FormsClient', () => {
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

  it('支持动态字段增删，并同步字段集合、值和错误聚合', () => {
    const form = useForm({ name: '' })
    const fields = form.addField('phone', '', { validators: rules.required })

    expect(form.fieldNames.value).toEqual(new Set(['name', 'phone']))
    expect((form.values as Readonly<Record<string, unknown>>).phone).toBe('')
    expect(fields.validate()).toBe('必填')
    expect(form.errors.value).toEqual({ phone: '必填' })

    expect(form.removeField('phone')).toBe(true)
    expect(form.removeField('phone')).toBe(false)
    expect(form.fieldNames.value).toEqual(new Set(['name']))
    expect((form.values as Readonly<Record<string, unknown>>).phone).toBeUndefined()
    expect(form.errors.value).toEqual({})
    form.dispose()
  })

  it('异步校验支持防抖，并在新校验开始时取消旧 AbortSignal', async () => {
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

  it('新一轮异步校验会 abort 旧校验，并只保留最新结果', async () => {
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

  it('官方 Field 提供默认输入、label、错误显示和双向值绑定', async () => {
    setRenderer(createDOMRenderer())
    const form = useForm({ name: '' }, { validateOn: 'blur', validators: { name: rules.required } })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => Field({ form, name: 'name', label: '姓名' })
    })
    app.mount(container)

    const input = container.querySelector('input') as HTMLInputElement
    expect(container.querySelector('label')?.textContent).toBe('姓名')
    input.value = 'Alice'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(form.values.name).toBe('Alice')

    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    await nextMicrotask()
    expect(container.querySelector('[data-vobs-field-error]')?.textContent).toBe('必填')
    app.destroy()
    form.dispose()
  })
})
