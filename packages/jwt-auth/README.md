# @vobs/jwt-auth

JWT session layer on top of `@vobs/auth` with in-memory access tokens and deduplicated concurrent refresh.

## Install

```bash
npm install @vobs/jwt-auth
```

## Quick start

```ts
import { createJWTAuth } from '@vobs/jwt-auth'

const user = { id: '42', roles: ['admin'], permissions: ['users:read'] }

const auth = createJWTAuth({
  transport: {
    login: async credentials => ({ accessToken: 'access-1', user }),
    refresh: async () => ({ accessToken: 'access-2' })
  },
  onAuthFailure: error => {
    // The session and token are already cleared when this runs.
  }
})

await auth.login({ username: 'admin', password: 'secret' })
auth.getAccessToken() // 'access-1'

// Concurrent calls share one in-flight request.
await Promise.all([auth.refreshToken(), auth.refreshToken()])
await auth.logout()
```

## API

| Signature | Description |
| --- | --- |
| `createJWTAuth(options: JWTAuthOptions<C>): JWTAuthContext<C>` | Builds a JWT auth context; `options.transport` must provide `login` and `refresh`. |
| `auth.transport` | User-supplied `JWTAuthTransport` handling the actual network calls. |
| `auth.accessToken: Signal<string or null>` | Reactive access token, kept in memory only. |
| `auth.getAccessToken(): string | null` | Returns the current access token. |
| `auth.refreshToken(): Promise<string>` | Refreshes the token; concurrent calls share one in-flight `transport.refresh()`. |
| `auth.login(credentials: C): Promise<void>` | Calls `transport.login`, stores the token and user as the session. |
| `auth.logout(): Promise<void>` | Calls `transport.logout` if present, then clears the token and session. |
| `auth.dispose(): void` | Disposes the token and underlying auth signals. |
| `jwtAuthPlugin(options?: JWTAuthPluginOptions<C>): VobsPlugin` | Provides the context through both `AUTH_KEY` and `JWT_AUTH_KEY`. |
| `useJWTAuth(): JWTAuthContext` | Injects the JWT auth context inside components. |

When `refresh` fails, the session and access token are cleared, `onAuthFailure` is invoked, and the rejection propagates to every caller sharing the request. All other members (`session`, `status`, `hasPermission`, `hasRole`, `requirePermission`, `requireRole`) are inherited from `AuthContext`.

## Types

`JWTAuthTransport`, `JWTLoginResult`, `JWTRefreshResult`, `JWTAuthOptions`, `JWTAuthContext`, `JWTAuthPluginOptions`
