import type { Validator } from './form'

export const rules = {
  required(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return 'Required'
    return null
  },

  email(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : 'Invalid email format'
  },

  phone(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    return /^1[3-9]\d{9}$/.test(String(value)) ? null : 'Invalid phone number format'
  },

  minLength(min: number): Validator<string | null | undefined, object> {
    assertNonNegativeInteger(min, 'minLength')
    return value => value === undefined || value === null || value.length >= min
      ? null
      : `At least ${min} characters`
  },

  maxLength(max: number): Validator<string | null | undefined, object> {
    assertNonNegativeInteger(max, 'maxLength')
    return value => value === undefined || value === null || value.length <= max
      ? null
      : `At most ${max} characters`
  },

  min(minimum: number): Validator<number | null | undefined, object> {
    assertFiniteNumber(minimum, 'min')
    return value => value === undefined || value === null || value >= minimum
      ? null
      : `Cannot be less than ${minimum}`
  },

  max(maximum: number): Validator<number | null | undefined, object> {
    assertFiniteNumber(maximum, 'max')
    return value => value === undefined || value === null || value <= maximum
      ? null
      : `Cannot be greater than ${maximum}`
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
  if (!Number.isInteger(value) || value < 0) throw new Error(`Vobs forms: ${name} must be an integer greater than or equal to 0`)
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`Vobs forms: ${name} must be a finite number`)
}
