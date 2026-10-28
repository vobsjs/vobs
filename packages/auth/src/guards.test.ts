import { describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createText, createVobs, setRenderer } from '@vobs/vobs'
import {
  RequireAllPermissions,
  RequireAnyPermission,
  RequireAuth,
  RequirePermission,
  RequireRole,
  authPlugin,
  createAuth,
  type AuthContext,
  type Session
} from './index'

setRenderer(createDOMRenderer())

/**
 * The three guards (RequireAuth / RequirePermission / RequireRole plus their Any/All variants) had
 * **zero tests across the repo** (§12.3). These components are the single exit point for
 * "authorization decision → which subtree gets rendered", so a missed test means a hole that lets
 * traffic through.
 */
const session: Session = {
  user: { id: 'ada', roles: ['editor'], permissions: ['article:read', 'article:edit'] }
}

function mountGuard(
  auth: AuthContext,
  component: (props: never) => unknown,
  props: Record<string, unknown>
): { container: HTMLElement; update: () => void; destroy: () => void } {
  const container = document.createElement('main')
  const app = createVobs({
    render: () => createComponent(component as never, props as never) as never,
    plugins: [authPlugin({ auth })]
  })
  app.mount(container)
  return { container, update: () => app.update(), destroy: () => app.destroy() }
}

const guardProps = {
  children: () => createText('SECRET'),
  fallback: () => createText('DENIED')
}

describe('@vobs/auth Guard components', () => {
  it('RequireAuth: anonymous shows fallback, signed-in shows children, back to fallback after logout', async () => {
    const auth = createAuth({
      loginHandler: async () => session
    })
    const view = mountGuard(auth, RequireAuth, { ...guardProps })
    expect(view.container.textContent).toBe('DENIED')

    await auth.login({})
    view.update()
    expect(view.container.textContent).toBe('SECRET')

    auth.logout()
    view.update()
    expect(view.container.textContent).toBe('DENIED')

    view.destroy()
    auth.dispose()
  })

  it('RequirePermission / RequireRole: allow by permission and role, recomputed as the session changes', () => {
    const auth = createAuth()
    const permission = mountGuard(auth, RequirePermission, { ...guardProps, permission: 'article:read' })
    const role = mountGuard(auth, RequireRole, { ...guardProps, role: 'editor' })
    expect(permission.container.textContent).toBe('DENIED')
    expect(role.container.textContent).toBe('DENIED')

    auth.session.value = session
    permission.update()
    role.update()
    expect(permission.container.textContent).toBe('SECRET')
    expect(role.container.textContent).toBe('SECRET')

    auth.session.value = { user: { id: 'bob', roles: [], permissions: [] } }
    permission.update()
    role.update()
    expect(permission.container.textContent).toBe('DENIED')
    expect(role.container.textContent).toBe('DENIED')

    permission.destroy()
    role.destroy()
    auth.dispose()
  })

  it('RequireAnyPermission: any match allows; empty list denies', () => {
    const auth = createAuth()
    const any = mountGuard(auth, RequireAnyPermission, { ...guardProps, permissions: ['article:read', 'other:x'] })
    const empty = mountGuard(auth, RequireAnyPermission, { ...guardProps, permissions: [] })
    auth.session.value = session
    any.update()
    empty.update()
    expect(any.container.textContent).toBe('SECRET')
    expect(empty.container.textContent).toBe('DENIED')
    any.destroy()
    empty.destroy()
    auth.dispose()
  })

  it('RequireAllPermissions: all must match; empty list counts as "not satisfied" (fail closed)', () => {
    const auth = createAuth()
    const all = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: ['article:read', 'article:edit'] })
    const missing = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: ['article:read', 'admin'] })
    const empty = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: [] })
    // anonymous + empty list: `[].every(...)` used to be always true, which handed out SECRET
    expect(empty.container.textContent).toBe('DENIED')
    auth.session.value = session
    all.update()
    missing.update()
    empty.update()
    expect(all.container.textContent).toBe('SECRET')
    expect(missing.container.textContent).toBe('DENIED')
    // signed-in + empty list: also treated as "not satisfied" (consistent with RequireAnyPermission([]))
    expect(empty.container.textContent).toBe('DENIED')
    all.destroy()
    missing.destroy()
    empty.destroy()
    auth.dispose()
  })

  /*
   * §12.3 #4 claims `RequireAuth` using `Boolean(session.value)` is a "second source of truth".
   * Measured: `status` is exactly `session.value ? 'authenticated' : 'anonymous'`, so the two are
   * **always equivalent** — not a defect (unlike the report's claim that "it allows when
   * session.value={} while hasPermission denies": that is the normal semantics of
   * "signed-in but permissionless", which hasPermission is supposed to contradict).
   * This test pins the equivalence so a one-sided change cannot make them silently drift apart.
   */
  it('RequireAuth is always equivalent to status (pinned; not two sources of truth)', () => {
    const auth = createAuth()
    const view = mountGuard(auth, RequireAuth, { ...guardProps })
    const agree = (): void => {
      view.update()
      expect(view.container.textContent === 'SECRET').toBe(auth.status.value === 'authenticated')
    }
    agree()                                                              // anonymous
    auth.session.value = session
    agree()                                                              // signed-in with permissions
    auth.session.value = { user: { id: 'bob', roles: [], permissions: [] } }
    agree()                                                              // signed-in with zero permissions: still authenticated
    view.destroy()
    auth.dispose()
  })

  it('guards always fail closed for anonymous users (no throw, no access)', () => {
    const auth = createAuth()
    for (const [component, props] of [
      [RequireAuth, {}],
      [RequirePermission, { permission: 'article:read' }],
      [RequireRole, { role: 'editor' }],
      [RequireAnyPermission, { permissions: ['article:read'] }],
      [RequireAllPermissions, { permissions: ['article:read'] }]
    ] as const) {
      const view = mountGuard(auth, component as never, { ...guardProps, ...props })
      expect(view.container.textContent).toBe('DENIED')
      view.destroy()
    }
    auth.dispose()
  })
})
