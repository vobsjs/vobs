import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Field, useForm } from './index'

/*
 * The default input branch of `Field` previously **passed through no props at all** — `extra`
 * was only spread in the `component` branch, so `<Field name="password" type="password"
 * placeholder="…">` rendered a plain-text `type="text"` box and the placeholder vanished, both
 * **silently** (no warning, no test coverage). In the same file the component branch passed
 * everything through and the default branch passed nothing; the README gave no hint of the
 * difference. Fix: hoist the passthrough set to the top of the function, shared by both branches.
 */
function mountField(props: Record<string, unknown>, values: Record<string, unknown> = {}) {
  setRenderer(createDOMRenderer())
  const form = useForm({ ...values, ...(props.name ? { [props.name as string]: '' } : {}) })
  const container = document.createElement('div')
  const app = createVobs({ render: () => Field({ ...props, form } as never) })
  app.mount(container)
  return { app, form, container }
}

describe('Field default-input passthrough props', () => {
  it('type="password" is no longer silently swapped to plain-text', () => {
    const { app, form, container } = mountField({ name: 'password', type: 'password' })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('password')
    // before the fix this was 'text' (the HTML default) + a missing placeholder
    app.destroy()
    form.dispose()
  })

  it('placeholder / autocomplete / inputmode / required are all passed through', () => {
    const { app, form, container } = mountField({
      name: 'email',
      type: 'email',
      placeholder: '请输入邮箱',
      autocomplete: 'email',
      inputMode: 'email',
      required: true
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('placeholder')).toBe('请输入邮箱')
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(input.getAttribute('inputmode')).toBe('email')
    expect(input.getAttribute('required')).toBe('true')
    app.destroy()
    form.dispose()
  })

  it('props whose value is undefined do not become attributes (no required="undefined")', () => {
    const { app, form, container } = mountField({ name: 'nick', placeholder: undefined, type: 'text' })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.hasAttribute('placeholder')).toBe(false)
    expect(input.getAttribute('type')).toBe('text')
    app.destroy()
    form.dispose()
  })

  it('aria-* and data-* are passed through too (accessibility labels no longer lost)', () => {
    const { app, form, container } = mountField({
      name: 'phone',
      'aria-label': '手机号',
      'data-testid': 'phone-input'
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBe('手机号')
    expect(input.getAttribute('data-testid')).toBe('phone-input')
    app.destroy()
    form.dispose()
  })

  it('the 5 framework-consumed fields do not leak into attributes', () => {
    const { app, form, container } = mountField({ name: 'title', label: '标题', type: 'text' })
    const input = container.querySelector('input') as HTMLInputElement
    for (const leaked of ['form', 'label', 'children', 'component', 'name']) {
      expect(input.hasAttribute(leaked), `${leaked} must not land as an input attribute`).toBe(false)
    }
    // label still goes through the <label> element; name still lands only on the wrapper's data-vobs-field
    expect(container.querySelector('label')?.textContent).toBe('标题')
    expect(container.querySelector('[data-vobs-field]')?.getAttribute('data-vobs-field')).toBe('title')
    app.destroy()
    form.dispose()
  })

  it('when the field value is null/undefined the input is an empty string, not the literal "undefined"', () => {
    setRenderer(createDOMRenderer())
    const form = useForm<{ nickname: string | undefined }>({ nickname: undefined })
    const container = document.createElement('div')
    const app = createVobs({ render: () => Field({ form, name: 'nickname' }) })
    app.mount(container)

    const input = container.querySelector('input') as HTMLInputElement
    // before the fix this was 'undefined' (a pit the binding layer bind.ts had already guarded once; Field walked around it and stepped on it again)
    expect(input.value).toBe('')
    app.destroy()
    form.dispose()
  })

  it('a passthrough type does not break two-way binding', () => {
    const { app, form, container } = mountField({ name: 'password', type: 'password' })
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 's3cret'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(form.values.password).toBe('s3cret')
    expect(input.getAttribute('type')).toBe('password')
    app.destroy()
    form.dispose()
  })
})
