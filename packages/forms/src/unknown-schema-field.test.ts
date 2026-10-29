// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useForm } from './index'

/*
 * A misspelled field name in the schema was originally **silently dropped**.
 *
 * `applyAllErrors` only iterated the form's own `names` (the `for (const name of names)` in
 * form.ts), with only `__form` special-cased. So when `schema.validate` returned
 * `{ phone: 'Phone number is required' }` while the form field is `name`: that error **never joined the
 * aggregation**, `validateAll()` returned `{}`, `hasErrors` was false, and `submit()` went
 * straight to valid:true and actually submitted — a misspelled field name gave no sign at all.
 *
 * The current fix is a **warning** (not a throw): schema as a "superset" is a legitimate usage,
 * and throwing would kill those usages too.
 * Note this only makes the problem **visible**; the "submit still passes" half is **not fixed**,
 * and the assertions below reflect the status quo faithfully.
 */
describe('forms schema misspelled field name', () => {
  it('gives an actionable warning when it returns field names absent from the form', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    /*
     * Note: a misspelled field name is already rejected **at the type level** (the schema's
     * return type is `Partial<Record<FormErrorName<…>, string>>`). What can actually reach this
     * runtime warning is a loose/untyped schema — e.g. a shared generic validator map, or JS
     * callers. The cast here explicitly means "this is a runtime scenario".
     */
    const schema = { validate: () => ({ phone: 'Phone number is required' }) } as unknown as NonNullable<
      Parameters<typeof useForm<{ name: string }>>[1]
    >['schema']
    const form = useForm({ name: 'Alice' }, { schema })

    expect(form.validateAll()).toEqual({})          // this error indeed does not join the aggregation
    expect(form.hasErrors.value).toBe(false)
    // recorded faithfully: submit is still allowed — this behavior was not changed here, only made no longer silent
    await expect(form.submit()).resolves.toMatchObject({ valid: true })

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('phone')
    expect(message).toContain('name')               // the hint lists the valid field names for easy comparison
    warn.mockRestore()
  })

  it('stays quiet when the field name is correct', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const form = useForm({ name: 'Alice' }, {
      schema: { validate: () => ({ name: 'At least 2 characters' }) }
    })

    expect(form.validateAll()).toEqual({ name: 'At least 2 characters' })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
