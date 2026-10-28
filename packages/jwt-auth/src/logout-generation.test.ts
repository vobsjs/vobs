// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createJWTAuth } from './index'

/*
 * An in-flight login or refresh landing after logout/dispose **must not resurrect the session**
 * (security level).
 *
 * `loginHandler` (index.ts:54) and `refreshToken` (:75-76) wrote token/session **unconditionally**
 * after the `await`, with no generation check. Measured in the deep-read report: letting an
 * in-flight login through after logout flipped the session back to signed-in; an in-flight refresh
 * resurrected it the same way; worse, **a new refreshToken() after logout still reused the
 * pre-logout in-flight promise** (refresh went out once, and both callers got the pre-logout token).
 *
 * Fix follows resource's revision counter: add a `generation`, advance it on logout, and discard
 * any result landing with a mismatched generation (don't write token/session, reject that promise).
 * A stale failure **must not** clear the new round's session either.
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

describe('jwt-auth logout must not be resurrected', () => {
  it('a login landing during logout is rejected and does not write back session/token', async () => {
    const gate = deferred<LoginResult>()
    const auth = makeAuth({ login: () => gate.promise })

    const pending = auth.login({} as never).catch((error: unknown) => error)
    await auth.logout()

    gate.resolve({ accessToken: 'A', user: USER })
    const error = await pending

    expect(error, 'stale login must be rejected').toBeInstanceOf(Error)
    expect(auth.session.value, 'session was resurrected by an in-flight login after logout').toBeNull()
    expect(auth.accessToken.value, 'stale token was written back').toBeNull()
    auth.dispose()
  })

  it('a refresh landing during logout is rejected and does not write back token/session', async () => {
    const gate = deferred<{ accessToken: string }>()
    const auth = makeAuth({ refresh: () => gate.promise })

    const pending = auth.refreshToken().catch((error: unknown) => error)
    await auth.logout()

    gate.resolve({ accessToken: 'R' })
    const error = await pending

    expect(error).toBeInstanceOf(Error)
    expect(auth.accessToken.value).toBeNull()
    expect(auth.session.value, 'session was resurrected by an in-flight refresh after logout').toBeNull()
    auth.dispose()
  })

  it('a new refresh after logout does not reuse the pre-logout promise (original report: refresh went out only once)', async () => {
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

    expect(calls, 'a refresh must be re-issued after logout').toBe(2)
    expect(freshResult, 'the new round must receive the new token').toBe('NEW')
    expect(auth.accessToken.value).toBe('NEW')
    auth.dispose()
  })

  it('normal login / refresh behavior unchanged (non-regression)', async () => {
    const auth = makeAuth()
    await auth.login({} as never)
    expect(auth.accessToken.value).toBe('A')
    expect(await auth.refreshToken()).toBe('R')
    expect(auth.accessToken.value).toBe('R')
    auth.dispose()
  })
})
