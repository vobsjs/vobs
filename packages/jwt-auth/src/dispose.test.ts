// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createJWTAuth } from './index'

/*
 * dispose() must actually destroy the underlying auth.
 *
 * `Object.assign(baseAuth, {...})` mutates baseAuth itself, so `baseAuth.dispose()` was a
 * **self-call**: `disposed = true` was just written, the guard returned immediately, and the
 * original implementation was never reached → the underlying createAuth was never disposed.
 * Measured (deep-read report): after `app.destroy()`, `login()` still succeeded and
 * `hasPermission` stayed true. **And the existing tests happened to only assert
 * `getAccessToken()`, which still throws → false green.**
 *
 * This test watches for "the underlying context is truly dead after disposal": login must be denied.
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
  it('login() must fail after dispose() (previously it still succeeded)', async () => {
    const auth = makeAuth()
    await auth.login({} as never)
    expect(auth.accessToken.value).toBe('A')

    auth.dispose()

    await expect(auth.login({} as never)).rejects.toThrow()
    /*
     * Deliberately **not** asserting that the session is cleared: a lingering session after disposal
     * is a **separate** documented defect of `@vobs/auth` (§12.3 #8 "dispose() does not clear
     * session.value") and is out of scope for this "dispose no-op" fix. Not smuggling a second fix
     * into this test.
     */
  })

  it('dispose() is idempotent (repeated calls do not throw)', () => {
    const auth = makeAuth()
    auth.dispose()
    expect(() => auth.dispose()).not.toThrow()
  })
})
