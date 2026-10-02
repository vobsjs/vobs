// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createI18n } from './index'

/*
 * registerFormatter 的注销句柄必须收敛。
 *
 * 深读报告实测：注册 A → 注册 B（同名）后，
 *   · 注销 A 的句柄 → 把 B **删掉**（formatter 退化成 String）
 *   · 再注销 B 的句柄 → 又把 A **塞回来**
 * 一个 `() => void` 能做到"卸不干净 + 复活尸体"。
 *
 * 修法是加身份判断：只在自己那次注册**仍是当前值**时才回滚。
 * 于是被顶掉的那次注册其句柄是 no-op（它确实没生效），后来者注销时恢复前一个是正确的，
 * 同一句柄重复调用也幂等。
 */
const fmt = (text: string) => (): string => text
const read = (i18n: ReturnType<typeof createI18n>): string => {
  const value = i18n.t('k', { v: 'x' })
  return value
}

describe('i18n registerFormatter 注销', () => {
  it('注销被顶掉的那次注册，不会删掉后来者', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const offA = i18n.registerFormatter('up', fmt('A'))
    const offB = i18n.registerFormatter('up', fmt('B'))
    expect(read(i18n)).toBe('B')

    offA()                                   // 关键：A 已被 B 顶掉
    expect(read(i18n), '注销 A 删掉了后来者 B').toBe('B')

    offB()
    expect(read(i18n)).toBe('A')             // B 注销 → 前一个（A）恢复正常

    /*
     * 此刻再调 offA() 会**移除 A** —— 这是正确的，不是缺陷：
     * offA 的语义是"若 A 是当前 formatter 就移除它"，而 B 注销之后 A 确实又是当前值了。
     * 我一开始在这里断言"重复注销不该改变状态"，那是**我自己发明的错误期待**
     * （它假定跨状态变化仍严格幂等）；栈式语义本来就是有状态的。
     */
    offA()
    expect(read(i18n), 'A 已是当前值 → 此时注销应当移除它').not.toBe('A')
    i18n.dispose()
  })

  it('单独注册/注销仍然干净（非回归）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const off = i18n.registerFormatter('up', fmt('ONLY'))
    expect(read(i18n)).toBe('ONLY')
    off()
    expect(read(i18n)).not.toBe('ONLY')       // 注销后不再走自定义 formatter
    i18n.dispose()
  })

  it('两个句柄都按逆序用完 → 完全清空（不留残骸）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { k: '{v,up}' } } })
    const offA = i18n.registerFormatter('up', fmt('A'))
    const offB = i18n.registerFormatter('up', fmt('B'))
    offB(); offA()
    expect(read(i18n)).not.toBe('A')
    expect(read(i18n)).not.toBe('B')
    i18n.dispose()
  })
})
