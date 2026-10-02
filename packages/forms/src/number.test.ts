// @vitest-environment jsdom
/*
 * 数字输入解析契约（外部踩坑文档 #7）。
 *
 * 核心事实：`Number('') === 0` —— 用户把输入框清空的瞬间值被当成 0 写进信号。
 * 在「比例锁定 / 联动计算」链路里 `0` 经除法变成 `Infinity`，再把兄弟维度一并清零：
 * **清一个输入框，旁边几个也跟着归零**。
 *
 * 契约：数字语义的输入走 `parseNumber` —— 空串 / 非法 / 超界一律**不提交**，
 * 信号保持最后一次有效值。
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { createForm, Field, parseNumber, describeNumberParseFailure } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('parseNumber', () => {
  it('**空串不提交**（这是它存在的首要理由）', () => {
    expect(parseNumber('').ok).toBe(false)
    expect(parseNumber('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseNumber('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('非法形态不提交（不用 Number() 的宽松解析）', () => {
    for (const text of ['abc', '1.2.3', '--1', '1,000', '12px', '1e3', '0x10', 'Infinity', 'NaN']) {
      const result = parseNumber(text)
      expect(result.ok, `${JSON.stringify(text)} 竟然被接受了`).toBe(false)
    }
  })

  it('合法十进制照常提交', () => {
    expect(parseNumber('0')).toEqual({ ok: true, value: 0 })
    expect(parseNumber('42')).toEqual({ ok: true, value: 42 })
    expect(parseNumber('-1.5')).toEqual({ ok: true, value: -1.5 })
    expect(parseNumber('+3')).toEqual({ ok: true, value: 3 })
    expect(parseNumber('.5')).toEqual({ ok: true, value: 0.5 })
    expect(parseNumber(' 7 ')).toEqual({ ok: true, value: 7 })
  })

  it('用户正在输入的中间态 `1.` 默认接受（拒绝会让输入过程很别扭）', () => {
    expect(parseNumber('1.')).toEqual({ ok: true, value: 1 })
    expect(parseNumber('1.', { allowTrailingDot: false }).ok).toBe(false)
  })

  it('超界**不提交**（不是静默钳制 —— 钳制会掩盖用户输入）', () => {
    expect(parseNumber('101', { max: 100 })).toEqual({ ok: false, reason: 'above-max' })
    expect(parseNumber('-1', { min: 0 })).toEqual({ ok: false, reason: 'below-min' })
    // 边界值本身是合法的（含端点）
    expect(parseNumber('100', { max: 100 })).toEqual({ ok: true, value: 100 })
    expect(parseNumber('0', { min: 0 })).toEqual({ ok: true, value: 0 })
  })

  it('integer 选项拒绝小数', () => {
    expect(parseNumber('1.5', { integer: true })).toEqual({ ok: false, reason: 'not-integer' })
    expect(parseNumber('2', { integer: true })).toEqual({ ok: true, value: 2 })
  })

  it('超长数字（形态合法但溢出为 Infinity）被挡住', () => {
    expect(parseNumber('1'.repeat(400)).ok).toBe(false)
  })

  it('失败原因都有中文说明', () => {
    for (const reason of ['empty', 'invalid', 'not-integer', 'below-min', 'above-max'] as const) {
      expect(describeNumberParseFailure(reason).length).toBeGreaterThan(0)
    }
  })
})

describe('Field type="number" 不把空串写成 0', () => {
  function mountNumericField(initial: unknown, extra: Record<string, unknown> = {}) {
    const form = createForm({ get ratio() { return initial } } as never)
    const onInvalid = vi.fn()
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Field, {
        form,
        name: 'ratio',
        type: 'number',
        onNumberInvalid: onInvalid,
        ...extra
      } as never)
    })
    app.mount(host)
    settle()
    const input = host.querySelector('input') as HTMLInputElement
    return { form, host, app, input, onInvalid, cleanup: () => { app.destroy(); host.remove() } }
  }

  it('清空输入框**不**把值变成 0（这是坑的原始形态）', () => {
    const view = mountNumericField(50)
    expect(view.input.value).toBe('50')

    view.input.value = ''
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()

    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value, '空串被当成了 0 —— 联动链会被清零').toBe(50)
    expect(view.input.value).toBe('')     // 框里仍是用户清空的状态（那是输入框自己的表现）
    view.cleanup()
  })

  it('非法输入不提交，并按 reason 通知调用方', () => {
    const view = mountNumericField(50)
    /*
     * 注意：`<input type="number">` **自己就会拒绝非法文本** ——
     * 给它 `.value = 'abc'` 会被浏览器归一成 `''`，所以这里走到的是 `empty` 而不是 `invalid`。
     * （`invalid` 由 `parseNumber` 直接覆盖，见上面的纯函数用例 ——
     * 文本框 + 数值语义 hint 的组合才会真正收到 'abc'。）
     */
    view.input.value = 'abc'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()

    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value, '非法输入被提交了').toBe(50)
    expect(view.onInvalid).toHaveBeenCalledWith('empty', '')
    view.cleanup()
  })

  it('文本框 + 数值 hint（min/max）能收到真正的非法文本', () => {
    const view = mountNumericField(50, { type: 'text', min: 0, max: 100 })
    view.input.value = 'abc'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(50)
    expect(view.onInvalid).toHaveBeenCalledWith('invalid', 'abc')
    view.cleanup()
  })

  it('超界不提交', () => {
    const view = mountNumericField(50, { max: 100 })
    view.input.value = '101'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(50)
    view.cleanup()
  })

  it('合法数字**提交为 number 类型**（不是字符串）', () => {
    const view = mountNumericField(50)
    view.input.value = '75'
    view.input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = view.form.field('ratio' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe(75)
    expect(typeof field.value.value, '数字框提交了字符串，调用方一除法就出事').toBe('number')
    view.cleanup()
  })

  it('文本框（无数字语义）行为不变 —— 仍原样写字符串', () => {
    const form = createForm({ get note() { return 'x' } } as never)
    const host = document.createElement('main')
    document.body.appendChild(host)
    const app = createVobs({
      render: () => createComponent(Field, { form, name: 'note', type: 'text' } as never)
    })
    app.mount(host)
    settle()
    const input = host.querySelector('input') as HTMLInputElement
    input.value = '任意文本'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    settle()
    const field = form.field('note' as never) as { value: { value: unknown } }
    expect(field.value.value).toBe('任意文本')
    app.destroy(); host.remove()
  })

  it('onNumberInvalid 不落成 DOM 属性', () => {
    const view = mountNumericField(50)
    expect(view.input.hasAttribute('onnumberinvalid')).toBe(false)
    view.cleanup()
  })
})
