import { describe, expect, it, vi } from 'vitest'
import { createText, createVobs } from '@vobs/vobs'
import { AUTH_KEY } from '@vobs/auth'
import { AuthError } from '@vobs/auth'
import { JWT_AUTH_KEY, createJWTAuth, jwtAuthPlugin, useJWTAuth } from './index'

const user = { id: '42', roles: ['admin'], permissions: ['users:read'] }

describe('@vobs/jwt-auth', () => {
  it('通过用户 transport 登录并只在内存中保存 token', async () => {
    const transport = {
      login: vi.fn(async () => ({ accessToken: 'access-1', user })),
      refresh: vi.fn(async () => ({ accessToken: 'access-2' }))
    }
    const auth = createJWTAuth({ transport })
    await auth.login({ username: 'admin', password: 'secret' })
    expect(auth.getAccessToken()).toBe('access-1')
    expect(auth.session.value?.user.id).toBe('42')
    expect(transport.login).toHaveBeenCalledWith({ username: 'admin', password: 'secret' })
    auth.dispose()
  })

  it('并发 refresh 只调用用户 transport 一次', async () => {
    let resolve!: (value: { accessToken: string }) => void
    const transport = {
      login: vi.fn(async () => ({ accessToken: 'access-1', user })),
      refresh: vi.fn(() => new Promise<{ accessToken: string }>(next => { resolve = next }))
    }
    const auth = createJWTAuth({ transport })
    await auth.login({})
    const first = auth.refreshToken()
    const second = auth.refreshToken()
    expect(transport.refresh).toHaveBeenCalledTimes(1)
    resolve({ accessToken: 'access-2' })
    await expect(Promise.all([first, second])).resolves.toEqual(['access-2', 'access-2'])
    auth.dispose()
  })

  it('refresh 失败时清空 session、token 并报告错误', async () => {
    const failure = new Error('expired refresh')
    const onAuthFailure = vi.fn()
    const auth = createJWTAuth({
      transport: {
        login: async () => ({ accessToken: 'access-1', user }),
        refresh: async () => { throw failure }
      },
      onAuthFailure
    })
    await auth.login({})
    await expect(auth.refreshToken()).rejects.toBe(failure)
    expect(auth.session.value).toBeNull()
    expect(auth.getAccessToken()).toBeNull()
    expect(onAuthFailure).toHaveBeenCalledWith(failure)
    auth.dispose()
  })

  it('登出只调用用户回调并清理本地状态', async () => {
    const logout = vi.fn()
    const auth = createJWTAuth({
      transport: {
        login: async () => ({ accessToken: 'access-1', user }),
        refresh: async () => ({ accessToken: 'access-2' }),
        logout
      }
    })
    await auth.login({})
    await auth.logout()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(auth.session.value).toBeNull()
    expect(auth.getAccessToken()).toBeNull()
    auth.dispose()
  })

  it('插件只注入用户提供的 auth，未提供依赖时明确报错', () => {
    let authContext: unknown
    let jwtContext: unknown
    const app = createVobs({
      render: () => createText('app'),
      plugins: [
        jwtAuthPlugin({ transport: {
          login: async () => ({ accessToken: 'access-1', user }),
          refresh: async () => ({ accessToken: 'access-2' })
        } }),
        { name: 'consumer', install(context) {
          authContext = context.inject(AUTH_KEY)
          jwtContext = context.inject(JWT_AUTH_KEY)
        } }
      ]
    })
    app.mount(document.createElement('div'))
    expect(authContext).toBe(jwtContext)
    app.destroy()
    expect(() => (jwtContext as ReturnType<typeof createJWTAuth>).getAccessToken()).toThrow('已销毁')

    const missing = createVobs({ render: () => { useJWTAuth(); return createText('') } })
    expect(() => missing.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'AUTH_CONTEXT_MISSING' })
    )
    expect(AuthError).toBeDefined()
  })
})
