// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createJWTAuth } from './index'

/*
 * 登出/销毁之后落地的 in-flight 登录或刷新**不得复活会话**（安全级）。
 *
 * `loginHandler`（index.ts:54）与 `refreshToken`（:75-76）在 `await` 之后**无条件写** token/session，
 * 没有任何世代检查。深读报告实测：logout 后放行 in-flight login → session 又变回已登录；
 * 放行 in-flight refresh 同样复活；而且 **logout 之后新的 refreshToken() 仍复用登出前的 in-flight promise**
 * （refresh 只发 1 次，两个调用者都拿到登出前的 token）。
 *
 * 修法照 resource 的 revision 计数：加 `generation`，logout 推进它，落地时代世不匹配就作废
 * （不写 token/session、拒绝该 promise），并且过期的失败**不能**清掉新一轮的会话。
 */
interface LoginResult { accessToken: string; user: { id: string; roles: string[]; permissions: string[] } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const USER = { id: '1', roles: ['admin'], permissions: ['x'] }

function makeAuth(overrides: Record<string, unknown> = {}) {
  return createJWTAuth({
    transport: {
      login: async () => ({ accessToken: 'A', user: USER }),
      refresh: async () => ({ accessToken: 'R' }),
      logout: async () => undefined,
      ...overrides
    }
  } as never)
}

describe('jwt-auth 登出不得被复活', () => {
  it('登出期间落地的 login 必须被拒，且不写回 session/token', async () => {
    const gate = deferred<LoginResult>()
    const auth = makeAuth({ login: () => gate.promise })

    const pending = auth.login({} as never).catch((error: unknown) => error)
    await auth.logout()

    gate.resolve({ accessToken: 'A', user: USER })
    const error = await pending

    expect(error, '过期的登录应当被拒绝').toBeInstanceOf(Error)
    expect(auth.session.value, '登出后被 in-flight login 复活了').toBeNull()
    expect(auth.accessToken.value, '过期的 token 被写回了').toBeNull()
    auth.dispose()
  })

  it('登出期间落地的 refresh 必须被拒，且不写回 token/session', async () => {
    const gate = deferred<{ accessToken: string }>()
    const auth = makeAuth({ refresh: () => gate.promise })

    const pending = auth.refreshToken().catch((error: unknown) => error)
    await auth.logout()

    gate.resolve({ accessToken: 'R' })
    const error = await pending

    expect(error).toBeInstanceOf(Error)
    expect(auth.accessToken.value).toBeNull()
    expect(auth.session.value, '登出后被 in-flight refresh 复活了').toBeNull()
    auth.dispose()
  })

  it('登出后的新 refresh 不复用登出前那次的 promise（原报告：refresh 只发 1 次）', async () => {
    const first = deferred<{ accessToken: string }>()
    const second = deferred<{ accessToken: string }>()
    let calls = 0
    const auth = makeAuth({ refresh: () => (++calls === 1 ? first.promise : second.promise) })

    const stale = auth.refreshToken().catch(() => undefined)
    await auth.logout()
    const fresh = auth.refreshToken().catch((error: unknown) => error)

    first.resolve({ accessToken: 'OLD' })
    await stale
    second.resolve({ accessToken: 'NEW' })
    const freshResult = await fresh

    expect(calls, '登出后应当重新发起刷新').toBe(2)
    expect(freshResult, '新一轮刷新应当拿到新 token').toBe('NEW')
    expect(auth.accessToken.value).toBe('NEW')
    auth.dispose()
  })

  it('正常 login / refresh 行为不变（非回归）', async () => {
    const auth = makeAuth()
    await auth.login({} as never)
    expect(auth.accessToken.value).toBe('A')
    expect(await auth.refreshToken()).toBe('R')
    expect(auth.accessToken.value).toBe('R')
    auth.dispose()
  })
})
