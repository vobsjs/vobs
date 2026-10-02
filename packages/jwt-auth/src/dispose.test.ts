// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createJWTAuth } from './index'

/*
 * dispose() 必须真的销毁底层的 auth。
 *
 * `Object.assign(baseAuth, {...})` 改的就是 baseAuth 本身，于是 `baseAuth.dispose()` 是**自调用**：
 * `disposed = true` 刚写完，守卫立刻 return，原实现永远执行不到 → 底层 createAuth 永不销毁。
 * 实测（深读报告）：`app.destroy()` 之后 `login()` 仍成功、`hasPermission` 仍 true。
 * **而现有测试恰好只断言那个还抛错的 `getAccessToken()` → 假绿。**
 *
 * 这条测试盯的是"销毁之后底层上下文真的失效"：login 必须被拒。
 */
function makeAuth() {
  return createJWTAuth({
    transport: {
      login: async () => ({ accessToken: 'A', user: { id: '1', roles: ['admin'], permissions: ['x'] } }),
      refresh: async () => ({ accessToken: 'A2' }),
      logout: async () => undefined
    }
  } as never)
}

describe('jwt-auth dispose', () => {
  it('dispose() 之后 login() 必须失效（原来仍然成功）', async () => {
    const auth = makeAuth()
    await auth.login({} as never)
    expect(auth.accessToken.value).toBe('A')

    auth.dispose()

    await expect(auth.login({} as never)).rejects.toThrow()
    /*
     * 这里**不**断言 session 被清空：销毁后 session 残留是 `@vobs/auth` 的**另一条**已记录缺陷
     * （§12.3 #8「dispose() 不清 session.value」），不属于本次"dispose 空转"的修复范围。
     * 不把第二条修偷偷塞进这一项。
     */
  })

  it('dispose() 幂等（重复调用不抛）', () => {
    const auth = makeAuth()
    auth.dispose()
    expect(() => auth.dispose()).not.toThrow()
  })
})
