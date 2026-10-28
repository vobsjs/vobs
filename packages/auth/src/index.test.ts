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
  useAuth,
  type Session
} from './index'

describe('@vobs/auth', () => {
  it('login, logout and permission checks keep the session reactive', async () => {
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

  /*
   * An in-flight login landing during logout/dispose used to write the session **unconditionally**
   * (no generation check after the await): if the user clicked logout while `auth.login()` was still
   * pending, the login result signed them back in the moment it landed.
   * Same root cause as jwt-auth (`6736eaf`, the revision pattern).
   */
  it('an in-flight login landing during logout must not sign the user back in', async () => {
    let release: ((session: Session) => void) | undefined
    const auth = createAuth({
      loginHandler: () => new Promise<Session>(resolve => { release = resolve })
    })
    const session: Session = { user: { id: 'ada', roles: ['admin'], permissions: ['article:read'] } }

    const pending = auth.login({ id: 'ada' })
    auth.logout()
    release!(session)

    await expect(pending).rejects.toMatchObject({ code: 'LOGIN_SUPERSEDED' })
    expect(auth.session.value).toBeNull()
    expect(auth.status.value).toBe('anonymous')
    expect(auth.hasPermission('article:read')).toBe(false)
    auth.dispose()
  })

  it('an in-flight login landing during dispose is discarded as well', async () => {
    let release: ((session: Session) => void) | undefined
    const auth = createAuth({
      loginHandler: () => new Promise<Session>(resolve => { release = resolve })
    })

    const pending = auth.login({})
    auth.dispose()
    release!({ user: { id: 'ada', roles: [], permissions: [] } })

    await expect(pending).rejects.toMatchObject({ code: 'LOGIN_SUPERSEDED' })
    expect(auth.session.value).toBeNull()
  })

  it('logging in again after logout still works (the generation only invalidates the interrupted attempt)', async () => {
    const auth = createAuth({
      loginHandler: async credentials => ({
        user: { id: String(credentials.id), roles: [], permissions: [] }
      })
    })
    auth.logout()
    await auth.login({ id: 'second' })
    expect(auth.session.value?.user.id).toBe('second')
    expect(auth.status.value).toBe('authenticated')
    auth.dispose()
  })

  it('missing login handler, denied permission and invalid session all raise AuthError', async () => {
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

  it('authPlugin injects the context and cleans up its own context on app destroy', () => {
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
    expect(() => (injected as ReturnType<typeof createAuth>).logout()).toThrow('disposed')
  })

  it('permission boundaries deny by default and re-render the subtree when the session changes', () => {
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

  it('works with a Router guard to deny anonymous access and redirect to the login page', async () => {
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

  it('HTTP request interceptors can read the current session and stop attaching credentials after logout', async () => {
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

  it('Resource fetcher reuses HTTP request interceptors carrying the Auth session', async () => {
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

  it('useAuth throws a clear error when the plugin is not installed', () => {
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
