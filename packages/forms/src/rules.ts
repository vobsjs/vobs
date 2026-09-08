import type { Validator } from './form'

export const rules = {
  required(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return '必填'
    return null
  },

  email(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : '邮箱格式错误'
  },

  phone(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    return /^1[3-9]\d{9}$/.test(String(value)) ? null : '手机号格式错误'
  },

  minLength(min: number): Validator<string | null | undefined, object> {
    assertNonNegativeInteger(min, 'minLength')
    return value => value === undefined || value === null || value.length >= min
      ? null
      : `至少 ${min} 个字符`
  },

  maxLength(max: number): Validator<string | null | undefined, object> {
    assertNonNegativeInteger(max, 'maxLength')
    return value => value === undefined || value === null || value.length <= max
      ? null
      : `最多 ${max} 个字符`
  },

  min(minimum: number): Validator<number | null | undefined, object> {
    assertFiniteNumber(minimum, 'min')
    return value => value === undefined || value === null || value >= minimum
      ? null
      : `不能小于 ${minimum}`
  },

  max(maximum: number): Validator<number | null | undefined, object> {
    assertFiniteNumber(maximum, 'max')
    return value => value === undefined || value === null || value <= maximum
      ? null
      : `不能大于 ${maximum}`
  },

  pattern(pattern: RegExp, message: string): Validator<string | null | undefined, object> {
    return value => {
      if (value === undefined || value === null || value === '') return null
      pattern.lastIndex = 0
      return pattern.test(value) ? null : message
    }
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Vobs forms: ${name} 必须是大于等于 0 的整数`)
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`Vobs forms: ${name} 必须是有限数字`)
}
