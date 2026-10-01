// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useForm } from './index'

/*
 * schema 里写错字段名，原来被**静默丢弃**。
 *
 * `applyAllErrors` 只遍历表单自己的 `names`（form.ts 里那个 `for (const name of names)`），
 * 只有 `__form` 被特判。于是 `schema.validate` 返回 `{ phone: '手机号必填' }`、而表单字段是
 * `name` 时：那条错误**根本不参与聚合**，`validateAll()` 返回 `{}`、`hasErrors` 为 false、
 * `submit()` 直接 valid:true 并真的执行提交 —— 拼错一个字段名不会有任何征兆。
 *
 * 现在的修法是**警告**（而不是抛错）：schema 作为"超集"是合法用法，抛错会把那些用法一并打死。
 * 注意这条只让问题**可见**，"提交仍会放行"这半边**没有修**，下面的断言如实反映现状。
 */
describe('forms schema 字段名写错', () => {
  it('返回表单里没有的字段名时给出可操作的警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    /*
     * 注意：字段名拼错在**类型层面**本来就会被拒绝（schema 的返回类型是
     * `Partial<Record<FormErrorName<…>, string>>`）。所以能走到这个运行时警告的，是
     * 宽松/无类型的 schema —— 比如共享一份通用校验器映射，或者 JS 调用方。
     * 这里用 cast 明确表示"这是运行时场景"。
     */
    const schema = { validate: () => ({ phone: '手机号必填' }) } as unknown as NonNullable<
      Parameters<typeof useForm<{ name: string }>>[1]
    >['schema']
    const form = useForm({ name: 'Alice' }, { schema })

    expect(form.validateAll()).toEqual({})          // 这条错误确实不参与聚合
    expect(form.hasErrors.value).toBe(false)
    // 如实记录：提交仍然被放行 —— 本次没有改这个行为，只是让它不再无声
    await expect(form.submit()).resolves.toMatchObject({ valid: true })

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('phone')
    expect(message).toContain('name')               // 提示里带上合法字段名，方便对照
    warn.mockRestore()
  })

  it('字段名正确时不吵', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const form = useForm({ name: 'Alice' }, {
      schema: { validate: () => ({ name: '至少 2 个字符' }) }
    })

    expect(form.validateAll()).toEqual({ name: '至少 2 个字符' })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
