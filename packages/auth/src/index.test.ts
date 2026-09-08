import { describe, expect, it } from 'vitest'
import { createElement, createText, createVobs, insertBefore, setRenderer, createDOMRenderer } from '@vobs/vobs'
import { createHTTPClient } from '@vobs/http'
import { createResourceClient } from '@vobs/resource'
import { createMemoryHistory, createRouter } from '@vobs/router'
import {
  AUTH_KEY,
  AuthError,
  RequireAnyPermission,
  RequireAuth,
  RequirePermission,
  authPlugin,
  createAuth,
  useAuth
} from './index'

describe('@vobs/auth', () => {
  it('登录、登出和权限判断保持响应式 session', async () => {
    const auth = createAuth({
      loginHandler: async credentials => ({
        user: {
          id: String(credentials.id),
          roles: ['editor'],
          permissions: ['article:read', 'article:edit']
        }
      })
    })

    expect(auth.status.value).toBe('anonymous')
    expect(auth.hasPermission('article:read')).toBe(false)
    await auth.login({ id: 7 })
    expect(auth.status.value).toBe('authenticated')
    expect(auth.hasRole('editor')).toBe(true)
    expect(auth.hasPermission('article:edit')).toBe(true)
    auth.requirePermission('article:read')
    auth.logout()
    expect(auth.status.value).toBe('anonymous')
    expect(auth.hasRole('editor')).toBe(false)
    auth.dispose()
  })

  it('未配置登录处理器、无权限和无效 session 都给出 AuthError', async () => {
    const auth = createAuth()
    await expect(auth.login({})).rejects.toMatchObject({ code: 'LOGIN_NOT_CONFIGURED' })
    expect(() => auth.requirePermission('admin')).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    )
    const invalid = createAuth({ loginHandler: () => ({ user: { id: '1' } } as never) })
    await expect(invalid.login({})).rejects.toMatchObject({ code: 'INVALID_SESSION' })
    auth.dispose()
    invalid.dispose()
  })

  it('authPlugin 注入上下文，并在应用销毁时清理自有上下文', () => {
    let injected: unknown
    const app = createVobs({
      render: () => createText('app'),
      plugins: [{
        name: 'consumer',
        requires: [authPlugin()],
        install(context) { injected = context.inject(AUTH_KEY) }
      }]
    })
    expect(injected).toBeDefined()
    app.destroy()
    expect(() => (injected as ReturnType<typeof createAuth>).logout()).toThrow('已销毁')
  })

  it('权限边界默认拒绝，并在 session 变化后更新子树', () => {
    setRenderer(createDOMRenderer())
    const auth = createAuth()
    const container = document.createElement('div')
    const app = createVobs({
      render: () => {
        const root = createElement('main')
        insertBefore(root, RequireAuth({ children: () => createText('signed-in') }), null)
        insertBefore(root, RequirePermission({
          permission: 'article:edit',
          children: () => createText('edit')
        }), null)
        insertBefore(root, RequireAnyPermission({
          permissions: ['article:read', 'article:edit'],
          children: () => createText('read-or-edit')
        }), null)
        return root
      },
      plugins: [authPlugin({ auth })]
    })

    app.mount(container)
    expect(container.textContent).toBe('')
    auth.session.value = { user: { id: '1', roles: [], permissions: ['article:edit'] } }
    app.update()
    expect(container.textContent).toBe('signed-ineditread-or-edit')
    auth.logout()
    app.update()
    expect(container.textContent).toBe('')
    app.destroy()
    auth.dispose()
  })

  it('可配合 Router 守卫拒绝匿名访问并重定向登录页', async () => {
    const auth = createAuth()
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/login', component: () => createText('login') },
        { path: '/private', component: () => createText('private'), meta: { requiresAuth: true } }
      ]
    })
    router.beforeEach(to => to.meta.requiresAuth && !auth.session.value ? '/login' : undefined)

    await expect(router.push('/private')).resolves.toMatchObject({ path: '/login' })
    auth.session.value = { user: { id: '1', roles: [], permissions: [] } }
    await expect(router.push('/private')).resolves.toMatchObject({ path: '/private' })
    router.destroy()
    auth.dispose()
  })

  it('可用 HTTP 请求拦截器读取当前 session 并在登出后停止携带凭证', async () => {
    const auth = createAuth()
    const seen: string[] = []
    const client = createHTTPClient({
      adapter: config => {
        seen.push(config.headers.Authorization ?? '')
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    client.interceptors.request.use(config => {
      const user = auth.session.value?.user
      if (user) config.headers.Authorization = `Session ${user.id}`
      return config
    })

    await client.get('/me')
    auth.session.value = { user: { id: '42', roles: [], permissions: [] } }
    await client.get('/me')
    auth.logout()
    await client.get('/me')
    expect(seen).toEqual(['', 'Session 42', ''])
    auth.dispose()
  })

  it('Resource fetcher 复用带 Auth session 的 HTTP 请求拦截器', async () => {
    const auth = createAuth()
    const client = createHTTPClient({
      adapter: config => new Response(JSON.stringify({
        id: config.headers.Authorization?.replace('Session ', '') ?? 'anonymous'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    client.interceptors.request.use(config => {
      const user = auth.session.value?.user
      if (user) config.headers.Authorization = `Session ${user.id}`
      return config
    })
    const resources = createResourceClient()
    const profile = resources.resource({
      key: ['profile'],
      fetcher: signal => client.get<{ id: string }>('/me', { signal }).then(response => response.data)
    })

    await profile.refetch()
    expect(profile.data.value).toEqual({ id: 'anonymous' })
    auth.session.value = { user: { id: '42', roles: [], permissions: [] } }
    resources.invalidate(['profile'])
    await profile.refetch()
    expect(profile.data.value).toEqual({ id: '42' })
    resources.clear()
    auth.dispose()
  })

  it('未安装插件时 useAuth 抛出明确错误', () => {
    const app = createVobs({ render: () => {
      useAuth()
      return createText('')
    } })
    expect(() => app.mount(document.createElement('div'))).toThrowError(
      expect.objectContaining({ code: 'AUTH_CONTEXT_MISSING' })
    )
    expect(AuthError).toBeDefined()
  })
})
