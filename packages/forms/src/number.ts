/**
 * 数字输入的**解析契约**（外部踩坑文档 #7 / 优化建议 #7）。
 *
 * ## 为什么需要它
 *
 * `Number('') === 0` —— 用户把输入框清空的瞬间，值被当成 `0` 写进信号。
 * 在「比例锁定 / 联动计算」这类链路里，`0` 会经除法变成 `Infinity`，
 * 再把兄弟维度一并清零：**清一个输入框，旁边几个也跟着归零**。
 * 这不是框架的 bug（`Number` 是 JS 语义），但框架可以给出正确的默认路径。
 *
 * ## 契约
 *
 * 数字语义的输入**一律走 `parseNumber`**：
 * - 空串 → **不提交**（保持原值）
 * - 非法（`'abc'` / `'1.2.3'` / `'--'`）→ **不提交**
 * - 超界（`min` / `max`）→ **不提交**（不是静默钳制 —— 钳制会让用户输入 `999` 时
 *   框里显示 `100` 而光标位置错乱，且用户不知道自己被改了）
 * - 只有**合法的有限数字**才提交
 *
 * 调用方拿 `reason` 决定要不要给反馈（例如把输入框标红 / 显示"请输入数字"）。
 *
 * ## 为什么"不提交"而不是"提交 0"或"钳制"
 *
 * `0` 会污染联动链（见上）；钳制会掩盖用户的真实输入。
 * 「保持原值不提交」是唯一不会产生**错误数据**的选择 ——
 * 界面上的空框由输入框自己表现，信号仍持有最后一次有效值。
 */

/** 解析失败的类别 —— 调用方据此决定提示文案。 */
export type NumberParseFailure = 'empty' | 'invalid' | 'below-min' | 'above-max' | 'not-integer'

export type NumberParseResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: NumberParseFailure }

export interface ParseNumberOptions {
  /** 下界（含）。 */
  readonly min?: number
  /** 上界（含）。 */
  readonly max?: number
  /** 只接受整数。 */
  readonly integer?: boolean
  /** 允许前导 `+` / 小数点结尾等中间态（默认允许 `'1.'`，因为用户正在输入）。 */
  readonly allowTrailingDot?: boolean
}

/**
 * 把输入框文本解析成数字。**不抛错**，用返回值表达结果。
 *
 * ```ts
 * const parsed = parseNumber(input.value, { min: 0, max: 100 })
 * if (parsed.ok) ratio.value = parsed.value
 * // 否则保持原值，需要时用 parsed.reason 给用户反馈
 * ```
 */
export function parseNumber(text: string, options: ParseNumberOptions = {}): NumberParseResult {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid' }
  const trimmed = text.trim()
  // 空串（含纯空白）不提交 —— 这是这个函数存在的**首要**理由
  if (trimmed === '') return { ok: false, reason: 'empty' }

  /*
   * 不用 `Number()` 做判定：它太宽松 ——
   * `Number('0x10')` = 16、`Number('1e3')` = 1000、`Number(' 12 ')` = 12、
   * `Number('Infinity')` = Infinity。对"用户正在输入的框"这些都不是期望行为。
   * 用显式形态匹配，只接受十进制数字。
   */
  const allowTrailingDot = options.allowTrailingDot ?? true
  const pattern = allowTrailingDot
    ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u
    : /^[+-]?(?:\d+\.\d+|\d+|\.\d+)$/u
  if (!pattern.test(trimmed)) return { ok: false, reason: 'invalid' }

  const value = Number(trimmed)
  // 形态合法仍可能是 Infinity（超长数字），必须挡住
  if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' }

  if (options.integer === true && !Number.isInteger(value)) {
    return { ok: false, reason: 'not-integer' }
  }
  if (options.min !== undefined && value < options.min) {
    return { ok: false, reason: 'below-min' }
  }
  if (options.max !== undefined && value > options.max) {
    return { ok: false, reason: 'above-max' }
  }
  return { ok: true, value }
}

/** 解析失败时给用户看的中文说明（调用方也可自己写文案）。 */
export function describeNumberParseFailure(reason: NumberParseFailure): string {
  switch (reason) {
    case 'empty': return '请输入数字'
    case 'invalid': return '请输入有效数字'
    case 'not-integer': return '请输入整数'
    case 'below-min': return '数值过小'
    case 'above-max': return '数值过大'
  }
}
