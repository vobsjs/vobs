/*
 * `vobs explain` —— 诊断码的可查询说明（Rust 的 `rustc --explain` 模式）。
 *
 * ## 为什么需要
 *
 * 这一轮里 C104–C108 的规则都是**读源码**才知道的；AI 只看到错误信息那一句。
 * Rust 生态被认为"对人不友好但 AI 友好"，很大程度就是因为规则**可以查，不用猜**。
 *
 * ## 要锁住的三条
 *
 * 1. **每条说明都回答四个问题**（是什么 / 为什么 / 正确 / 反例）—— 少一个就退回成"只有一句报错"
 * 2. **没有条目时不编** —— 明确说没有，并列出已收录的码。猜的文档比没有文档更糟
 * 3. **缺口可见** —— `--missing` 能列出源码里存在但没有条目的码，而不是让人以为"框架只有这几个码"
 */
import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_GUIDES, findDiagnosticGuide } from '@vobs/runtime'

describe('诊断说明登记表', () => {
  it('每条都回答四个问题（缺一就退回成"只有一句报错"）', () => {
    for (const guide of DIAGNOSTIC_GUIDES) {
      expect(guide.title.trim(), `${guide.code} 缺 title`).not.toBe('')
      expect(guide.why.trim(), `${guide.code} 缺 why（为什么会发生）`).not.toBe('')
      expect(guide.correct.trim(), `${guide.code} 缺 correct（正确写法）`).not.toBe('')
      expect(guide.wrong.trim(), `${guide.code} 缺 wrong（反例）`).not.toBe('')
    }
  })

  it('码唯一且格式正确', () => {
    const codes = DIAGNOSTIC_GUIDES.map(item => item.code)
    expect(new Set(codes).size, '有重复的码').toBe(codes.length)
    for (const code of codes) expect(code, `${code} 格式不对`).toMatch(/^VOBS_C\d{3}$/u)
  })

  it('严重度只用 error / warning', () => {
    for (const guide of DIAGNOSTIC_GUIDES) {
      expect(['error', 'warning']).toContain(guide.severity)
    }
  })

  it('**覆盖了本轮落地的全部诊断**（漏一个就等于那条规则不可查）', () => {
    const covered = new Set(DIAGNOSTIC_GUIDES.map(item => item.code))
    // 这些都是这一轮实际加过/改过的码；它们必须可查
    for (const code of ['VOBS_C104', 'VOBS_C105', 'VOBS_C106', 'VOBS_C107', 'VOBS_C108', 'VOBS_C118', 'VOBS_C210', 'VOBS_C211', 'VOBS_C232']) {
      expect(covered.has(code), `${code} 没有说明条目 —— 它不可查`).toBe(true)
    }
  })

  it('**说明必须指向正确写法**（只报错对 AI 没有价值）', () => {
    // C210 的说明必须教结构（on()）而不是只教补丁（untrack）
    const guide = findDiagnosticGuide('VOBS_C210')!
    expect(guide.correct).toContain('on(')
    expect(guide.correct).toContain('untrack')
    // 顺序：on( 出现在 untrack 之前（先教结构、再教补丁）
    expect(guide.correct.indexOf('on(')).toBeLessThan(guide.correct.indexOf('untrack'))
  })

  it('查不到的码返回 undefined（调用方必须显式处理，不许编）', () => {
    expect(findDiagnosticGuide('VOBS_C999')).toBeUndefined()
  })
})
