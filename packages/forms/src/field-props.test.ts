import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Field, useForm } from './index'

/*
 * `Field` 的默认输入分支此前**不透传任何 props** —— `extra` 只在 `component` 分支展开，
 * 于是 `<Field name="password" type="password" placeholder="…">` 渲染出 `type="text"` 的明文框、
 * placeholder 也消失，两者都**静默**（无警告、无测试覆盖）。
 * 同一份源码里 component 分支全透传、默认分支全不透，README 也读不出差别。
 * 修法：把透传集合提到函数顶部，两个分支共用。
 */
function mountField(props: Record<string, unknown>, values: Record<string, unknown> = {}) {
  setRenderer(createDOMRenderer())
  const form = useForm({ ...values, ...(props.name ? { [props.name as string]: '' } : {}) })
  const container = document.createElement('div')
  const app = createVobs({ render: () => Field({ ...props, form } as never) })
  app.mount(container)
  return { app, form, container }
}

describe('Field 默认输入透传 props', () => {
  it('type="password" 不再被静默换成明文 text', () => {
    const { app, form, container } = mountField({ name: 'password', type: 'password' })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('password')
    // 修复前这里是 'text'（HTML 默认值）+ placeholder 缺失
    app.destroy()
    form.dispose()
  })

  it('placeholder / autocomplete / inputmode / required 都透传', () => {
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

  it('值为 undefined 的 props 不落成属性（不产生 required="undefined"）', () => {
    const { app, form, container } = mountField({ name: 'nick', placeholder: undefined, type: 'text' })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.hasAttribute('placeholder')).toBe(false)
    expect(input.getAttribute('type')).toBe('text')
    app.destroy()
    form.dispose()
  })

  it('aria-* 与 data-* 也透传（可访问性标签不再丢失）', () => {
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

  it('框架消费的 5 个字段不会漏成属性', () => {
    const { app, form, container } = mountField({ name: 'title', label: '标题', type: 'text' })
    const input = container.querySelector('input') as HTMLInputElement
    for (const leaked of ['form', 'label', 'children', 'component', 'name']) {
      expect(input.hasAttribute(leaked), `${leaked} 不应落到 input 属性上`).toBe(false)
    }
    // label 仍走 <label> 元素、name 仍只落在 wrapper 的 data-vobs-field 上
    expect(container.querySelector('label')?.textContent).toBe('标题')
    expect(container.querySelector('[data-vobs-field]')?.getAttribute('data-vobs-field')).toBe('title')
    app.destroy()
    form.dispose()
  })

  it('field 值为 null/undefined 时输入框是空串而不是字面量 "undefined"', () => {
    setRenderer(createDOMRenderer())
    const form = useForm<{ nickname: string | undefined }>({ nickname: undefined })
    const container = document.createElement('div')
    const app = createVobs({ render: () => Field({ form, name: 'nickname' }) })
    app.mount(container)

    const input = container.querySelector('input') as HTMLInputElement
    // 修复前这里是 'undefined'（绑定层 bind.ts 已防过一次的坑，Field 自己绕过去又踩了）
    expect(input.value).toBe('')
    app.destroy()
    form.dispose()
  })

  it('透传的 type 不破坏双向绑定', () => {
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
