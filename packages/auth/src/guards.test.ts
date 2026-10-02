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
 * 三个 Guard（RequireAuth / RequirePermission / RequireRole 及其 Any/All 变体）**全仓零测试**
 * （§12.3）。这些组件是"授权判定 → 渲染哪一棵子树"的唯一出口，漏测的代价直接是放行。
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

describe('@vobs/auth Guard 组件', () => {
  it('RequireAuth：匿名显示 fallback，登录后显示 children，登出后再回 fallback', async () => {
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

  it('RequirePermission / RequireRole：按权限与角色放行，且随 session 变化重算', () => {
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

  it('RequireAnyPermission：任一满足即放行；空列表拒绝', () => {
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

  it('RequireAllPermissions：必须全部满足；空列表按"未满足"处理（fail closed）', () => {
    const auth = createAuth()
    const all = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: ['article:read', 'article:edit'] })
    const missing = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: ['article:read', 'admin'] })
    const empty = mountGuard(auth, RequireAllPermissions, { ...guardProps, permissions: [] })
    // 匿名 + 空列表：原来 `[].every(...)` 恒真，这里直接给出 SECRET
    expect(empty.container.textContent).toBe('DENIED')
    auth.session.value = session
    all.update()
    missing.update()
    empty.update()
    expect(all.container.textContent).toBe('SECRET')
    expect(missing.container.textContent).toBe('DENIED')
    // 已登录 + 空列表：同样按"未满足"处理（与 RequireAnyPermission([]) 结论一致）
    expect(empty.container.textContent).toBe('DENIED')
    all.destroy()
    missing.destroy()
    empty.destroy()
    auth.dispose()
  })

  /*
   * §12.3 #4 说 `RequireAuth` 用 `Boolean(session.value)` 是"第二个真相源"。
   * 实测：`status` 就是 `session.value ? 'authenticated' : 'anonymous'`，两者**恒等价** ——
   * 不是缺陷（不像报告说的"session.value={} 时它放行而 hasPermission 拒绝"：
   * 那是"已登录但无权限"的正常语义，hasPermission 与它本来就该相反）。
   * 这里把等价关系钉住，避免以后单边改动让两者悄悄分叉。
   */
  it('RequireAuth 的判定与 status 恒等价（钉住，不是两个真相源）', () => {
    const auth = createAuth()
    const view = mountGuard(auth, RequireAuth, { ...guardProps })
    const agree = (): void => {
      view.update()
      expect(view.container.textContent === 'SECRET').toBe(auth.status.value === 'authenticated')
    }
    agree()                                                              // 匿名
    auth.session.value = session
    agree()                                                              // 已登录且有权限
    auth.session.value = { user: { id: 'bob', roles: [], permissions: [] } }
    agree()                                                              // 已登录但零权限：仍然算 authenticated
    view.destroy()
    auth.dispose()
  })

  it('Guard 对匿名用户一律 fail closed（不抛错、不放行）', () => {
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
