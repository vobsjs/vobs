// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Field, useForm } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

/*
 * `setServerErrors()` must actually become visible.
 *
 * Field's error rendering gate is `touched && error` (field.ts:54-55). But `setServerErrors`
 * (form.ts:527) originally only wrote error without setting touched — so this API **designed
 * specifically for server errors** never showed on the framework's own official Field:
 * measured, error had a value, touched=false, nothing in the DOM; and as soon as the user typed
 * into the box, `field.error.value = null` inside `set()` (form.ts:453) cleared it again.
 *
 * The fix is not a backdoor in the renderer but restoring the semantics: server errors are by
 * definition about "values the user has already submitted", so that field was necessarily
 * interacted with — hence setServerErrors also marks touched.
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

describe('forms setServerErrors visibility', () => {
  it('after setting a server error, Field actually renders it', async () => {
    const form = useForm({ email: '' })
    const { host, cleanup } = mountField(form as never, 'email')
    await settle()

    expect(host.querySelector('[data-vobs-field-error]')).toBeNull()

    form.setServerErrors({ email: '邮箱已被注册' })
    await settle()

    const error = host.querySelector('[data-vobs-field-error]')
    expect(error, 'the error node was not rendered (this was exactly the original bug)').toBeTruthy()
    expect(host.textContent).toContain('邮箱已被注册')
    // semantics: a server error implies this field has already been interacted with
    expect(form.field('email').touched.value).toBe(true)
    cleanup()
  })

  it('after the user edits the field, the server error is cleared (editing invalidates it)', async () => {
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
