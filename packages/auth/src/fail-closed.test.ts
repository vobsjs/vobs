// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { effect, scheduler, state } from '@vobs/reactivity'
import { createAuth } from './index'
import type { Session } from './index'

/*
 * 权限判定必须**缺省拒绝**，不能抛错、不能子串匹配。
 *
 * 原来 `hasPermission` / `hasRole` 直接 `session.value?.user.permissions.includes(...)`：
 *  1. session 少了字段（水合不完整、`{}`）→ 抛 TypeError。挂载期崩；**更新期被 effect 吞掉**，
 *     吞掉之后旧的授权内容会留在页面上 —— 最放行的路径恰恰是最安静的那条（安全相关）；
 *  2. 字段若是字符串 → `.includes` 退化成**子串匹配**：`roles: 'editor'` 让 `hasRole('e')` 为真。
 * 现在只认"字符串数组"，否则当空数组 → 一律拒绝。
 */
const ok: Session = { user: { id: '1', roles: ['editor'], permissions: ['article:read'] } }

function make(session: Session | null) {
  const signal = state<Session | null>(session)
  return { auth: createAuth({ session: signal }), signal }
}

describe('auth 判定缺省拒绝', () => {
  it('session 形状不对时不抛错，而是一律拒绝', () => {
    for (const broken of [{} as Session, { user: {} } as unknown as Session, { user: null } as unknown as Session]) {
      const { auth } = make(broken)
      expect(() => auth.hasPermission('article:read')).not.toThrow()
      expect(() => auth.hasRole('editor')).not.toThrow()
      expect(auth.hasPermission('article:read')).toBe(false)
      expect(auth.hasRole('editor')).toBe(false)
    }
  })

  it('字符串字段不会被当成子串放行', () => {
    const { auth } = make({ user: { id: '1', roles: 'editor', permissions: 'article:read article:edit' } } as unknown as Session)
    expect(auth.hasRole('e'), 'roles 是字符串时绝不能子串命中').toBe(false)
    expect(auth.hasRole('editor')).toBe(false)
    expect(auth.hasPermission('read')).toBe(false)
    expect(auth.hasPermission('article:read')).toBe(false)
  })

  it('更新期不再把抛错吞掉（原来会静默留下旧内容）', () => {
    const { auth, signal } = make(ok)
    const reads: boolean[] = []
    // effect 里读判定：抛错会被框架吞（effect.ts 的错误路径），于是页面停在旧状态
    expect(() => {
      effect(() => { reads.push(auth.hasPermission('article:read')) })
      scheduler.flush()
    }).not.toThrow()
    expect(reads).toEqual([true])

    // 把 session 换成形状不对的 —— 更新期必须得到 false，而不是抛错后被吞
    expect(() => {
      signal.value = {} as Session
      scheduler.flush()
    }).not.toThrow()
    expect(reads, '更新后必须重新判定为拒绝').toEqual([true, false])
  })

  it('正常 session 行为不变（非回归）', () => {
    const { auth } = make(ok)
    expect(auth.hasPermission('article:read')).toBe(true)
    expect(auth.hasRole('editor')).toBe(true)
    expect(auth.hasPermission('nope')).toBe(false)
    expect(auth.hasRole('nope')).toBe(false)
  })

  it('数组中混入非字符串元素时，只认字符串（不误放行）', () => {
    const { auth } = make({ user: { id: '1', roles: [1, 'editor', null], permissions: [{}, 'x'] } } as unknown as Session)
    expect(auth.hasRole('editor')).toBe(true)
    expect(auth.hasPermission('x')).toBe(true)
    expect(auth.hasRole('1')).toBe(false)
  })
})
