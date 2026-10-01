// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Field, useForm } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

/*
 * `setServerErrors()` 必须真的显示出来。
 *
 * Field 的错误渲染门槛是 `touched && error`（field.ts:54-55）。而 `setServerErrors`
 * （form.ts:527）原来只写 error、不置 touched —— 于是这个**专为服务端错误设计的 API**，
 * 在框架自己的官方 Field 上永远显示不出来：实测 error 有值、touched=false、DOM 里什么都没有；
 * 用户只要动一下输入框，`set()` 里的 `field.error.value = null`（form.ts:453）还会把它清掉。
 *
 * 修法不是给渲染开个后门，而是补上语义：服务端错误按定义是针对"用户已经提交过的值"，
 * 那个字段必然已经交互过 —— 所以 setServerErrors 同时标记 touched。
 */
function mountField(form: ReturnType<typeof useForm>, name: string) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => Field({ form, name, label: name })
  })
  app.mount(host)
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('forms setServerErrors 可见性', () => {
  it('设置服务端错误后，Field 真的渲染出这条错误', async () => {
    const form = useForm({ email: '' })
    const { host, cleanup } = mountField(form as never, 'email')
    await settle()

    expect(host.querySelector('[data-vobs-field-error]')).toBeNull()

    form.setServerErrors({ email: '邮箱已被注册' })
    await settle()

    const error = host.querySelector('[data-vobs-field-error]')
    expect(error, '错误节点没渲染出来（原来就是这个问题）').toBeTruthy()
    expect(host.textContent).toContain('邮箱已被注册')
    // 语义：服务端错误意味着这个字段已经交互过
    expect(form.field('email').touched.value).toBe(true)
    cleanup()
  })

  it('用户改动字段后，这条服务端错误被清掉（编辑即失效）', async () => {
    const form = useForm({ email: '' })
    const { host, cleanup } = mountField(form as never, 'email')
    await settle()

    form.setServerErrors({ email: '邮箱已被注册' })
    await settle()
    expect(host.textContent).toContain('邮箱已被注册')

    form.field('email').set('other@example.com')
    await settle()
    expect(host.querySelector('[data-vobs-field-error]')).toBeNull()
    cleanup()
  })
})
