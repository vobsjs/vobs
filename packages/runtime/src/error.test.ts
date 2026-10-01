import { describe, expect, it } from 'vitest'
import { VobsError, formatVobsError, isVobsError, normalizeVobsError } from './error'

describe('Vobs error protocol', () => {
  it('normalizes unknown throws with a stable code', () => {
    const error = normalizeVobsError('offline', { code: 'VOBS_H001', layer: 'http' })
    expect(error).toBeInstanceOf(VobsError)
    expect(error.code).toBe('VOBS_H001')
    expect(error.layer).toBe('http')
    expect(error.message).toBe('offline')
  })

  it('formats actionable development and production output', () => {
    const error = new VobsError({
      code: 'VOBS_R001',
      message: 'Component render failed',
      cause: new TypeError('missing data'),
      fix: 'Guard the value before reading it.',
      location: { file: 'src/App.tsx', line: 4, column: 9 }
    })
    const output = formatVobsError(error)
    expect(output).toContain('Code: VOBS_R001')
    expect(output).toContain('Location: src/App.tsx:4:9')
    expect(output).toContain('Cause: TypeError: missing data')
    expect(output).toContain('Fix: Guard the value before reading it.')
    expect(formatVobsError(error, { environment: 'production' })).toBe('[Vobs VOBS_R001] Component render failed')
  })

  /*
   * 诊断系统自己丢诊断 —— 三处都是这样。
   * `isVobsError` 要求 code + message + layer 三者齐全，于是调用方递一个
   * `{ code, message }` 会被判为「不是 VobsError」，掉进 String(value) 兜底，
   * 输出 `[object Object]`，消息彻底消失。
   */
  describe('不丢消息', () => {
    it('code + message 的结构化对象保留消息', () => {
      const error = normalizeVobsError({ code: 'VOBS_H001', message: 'boom' })
      expect(error.message).toBe('boom')
      expect(error.message).not.toContain('[object')
      expect(error.code).toBe('VOBS_H001')
      expect(error.layer).toBe('runtime')
      expect(formatVobsError(error).split('\n')[0]).toBe('[Vobs Error] boom')
    })

    it('只有 message 的对象也保留消息', () => {
      expect(normalizeVobsError({ message: 'just a message' }).message).toBe('just a message')
    })

    it('既不是 Error 也没有 message 的值仍然给出可读内容', () => {
      expect(normalizeVobsError({ some: 'object' }).message).toContain('object')
      expect(normalizeVobsError(null).message).toBe('null')
    })

    it('isVobsError 不要求 layer 齐全', () => {
      expect(isVobsError({ code: 'X', message: 'y' })).toBe(true)
      expect(isVobsError({ code: 'X' })).toBe(false)
      expect(isVobsError('not an error')).toBe(false)
    })
  })

  /*
   * tsup `splitting: false` 让 error.ts 同时进 dist/index.js 与 dist/error.js，
   * 两份类互不 instanceof。跨入口传进来的实例必须被识别并复制成本地实例，
   * 否则下游的 instanceof 与格式化都会走偏。
   */
  describe('跨打包副本的类身份', () => {
    it('结构识别把外来实例复制成本地实例', () => {
      // 模拟「另一个副本」：名字与字段都像 VobsError，但不 instanceof 本地类
      const foreign = Object.assign(new Error('来自另一个副本'), {
        name: 'VobsError',
        code: 'VOBS_F001',
        severity: 'error',
        layer: 'runtime'
      })
      expect(foreign).not.toBeInstanceOf(VobsError)

      const adopted = normalizeVobsError(foreign)
      expect(adopted).toBeInstanceOf(VobsError)
      expect(adopted.code).toBe('VOBS_F001')
      expect(adopted.message).toBe('来自另一个副本')
      expect(adopted.cause).toBe(foreign)
    })

    it('本地实例原样返回，普通 Error 保持同一性', () => {
      const local = new VobsError({ code: 'VOBS_L', message: 'local' })
      expect(normalizeVobsError(local)).toBe(local)

      const plain = new TypeError('plain')
      const normalized = normalizeVobsError(plain, { code: 'VOBS_P' })
      expect(normalized).toBe(plain)
      expect((plain as { code?: string }).code).toBe('VOBS_P')
    })

    it('冻结的 Error 上挂不上元数据时复制成本地实例，而不是丢掉 code', () => {
      const frozen = Object.freeze(new Error('frozen boom'))
      const normalized = normalizeVobsError(frozen, { code: 'VOBS_FROZEN' })

      expect(normalized.code).toBe('VOBS_FROZEN')
      expect(normalized.message).toBe('frozen boom')
      expect(normalized.cause).toBe(frozen)
    })
  })
})
