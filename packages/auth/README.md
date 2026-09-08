# @vobs/auth

Reactive session state with role and permission checks, declarative access-control boundaries, and a typed error model.

## Install

```bash
npm install @vobs/auth
```

## Quick start

```ts
import { createAuth } from '@vobs/auth'

const auth = createAuth({
  loginHandler: async credentials => ({
    user: {
      id: String(credentials.id),
      roles: ['editor'],
      permissions: ['article:read', 'article:edit']
    }
  })
})

await auth.login({ id: 7 })
auth.status.value // 'authenticated'
auth.hasPermission('article:edit') // true
auth.requirePermission('article:delete') // throws AuthError with code 'PERMISSION_DENIED'
auth.logout()
auth.dispose()
```

## API

| Signature | Description |
| --- | --- |
| `createAuth(options?: AuthOptions<C>): AuthContext<C>` | Creates an auth context; owns a session signal unless `options.session` is provided. |
| `auth.session` | Reactive session signal, `null` when anonymous. |
| `auth.status: Signal<AuthStatus>` | `'anonymous'` or `'authenticated'`, derived from the session. |
| `auth.login(credentials: C): Promise<void>` | Calls `loginHandler`, validates the returned session, and stores it. |
| `auth.logout(): void` | Clears the session. |
| `auth.hasPermission(permission: Permission): boolean` | Checks the current user's permissions. |
| `auth.hasRole(role: string): boolean` | Checks the current user's roles. |
| `auth.requirePermission(permission: Permission): void` | Throws `AuthError('PERMISSION_DENIED')` when the permission is missing. |
| `auth.requireRole(role: string): void` | Throws `AuthError('PERMISSION_DENIED')` when the role is missing. |
| `auth.dispose(): void` | Disposes the session and status signals. |
| `authPlugin(options?: AuthPluginOptions<C>): VobsPlugin` | Provides the context through `AUTH_KEY` and disposes it with the app. |
| `useAuth(): AuthContext` | Injects the auth context inside components. |
| `RequireAuth(props?: AuthBoundaryProps): VobsNode` | Renders `children` while a session exists, otherwise `fallback`. |
| `RequirePermission(props: RequirePermissionProps): VobsNode` | Renders `children` when the permission is granted. |
| `RequireRole(props: RequireRoleProps): VobsNode` | Renders `children` when the role is granted. |
| `RequireAnyPermission(props: RequirePermissionsProps): VobsNode` | Renders `children` when at least one permission is granted. |
| `RequireAllPermissions(props: RequirePermissionsProps): VobsNode` | Renders `children` when every permission is granted. |

`login` validates that `loginHandler` returns a session with `user.id`, `user.roles`, and `user.permissions`, throwing `AuthError('INVALID_SESSION')` otherwise. All boundaries re-render reactively when the session signal changes.

## Types

`AuthContext`, `AuthOptions`, `AuthPluginOptions`, `AuthStatus`, `AuthErrorCode`, `Session`, `SessionUser`, `Role`, `Permission`, `Credentials`, `AuthBoundaryProps`, `RequirePermissionProps`, `RequireRoleProps`, `RequirePermissionsProps`
