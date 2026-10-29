import { createJWTAuth, JWT_AUTH_KEY } from '@vobs/jwt-auth'
import type { VobsPlugin } from '@vobs/vobs'
import { auth } from './auth'

/** Token TTL (seconds): intentionally short so expiry, refresh, and 401 replay are easy to observe. */
const TOKEN_TTL_SECONDS = 30

interface JwtPayload {
  readonly sub: string
  readonly iat: number
  readonly exp: number
}

export interface JwtTokenInfo {
  readonly token: string
  readonly payload: JwtPayload
}

function encodeToken(payload: JwtPayload): string {
  const header = btoa(JSON.stringify({ alg: 'demo', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.demo-signature`
}

export function decodeToken(token: string | null): JwtPayload | null {
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1] ?? '')) as JwtPayload
  } catch {
    return null
  }
}

export function getTokenInfo(token: string | null): JwtTokenInfo | null {
  const payload = decodeToken(token)
  return payload ? { token: token!, payload } : null
}

function issueToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000)
  return encodeToken({ sub, iat: now, exp: now + TOKEN_TTL_SECONDS })
}

export const jwtAuth = createJWTAuth({
  // Shares the same session signal as session auth: after a JWT login the route guard lets requests through as well.
  session: auth.session,
  transport: {
    async login(credentials) {
      await delay(300)
      const username = String(credentials.username ?? '').trim()
      if (!username) throw new Error('Please enter a username')
      return {
        accessToken: issueToken(username),
        user: {
          id: `jwt:${username}`,
          roles: username === 'admin' ? ['maintainer', 'admin'] : ['maintainer'],
          permissions: username === 'admin' ? ['users.read', 'users.write'] : ['users.read']
        }
      }
    },
    async refresh() {
      await delay(220)
      const session = auth.session.value
      if (!session) throw new Error('No session available, cannot refresh token')
      return { accessToken: issueToken(session.user.id.replace(/^jwt:/, '')) }
    }
  }
})

/**
 * jwtAuthPlugin would provide both AUTH_KEY and JWT_AUTH_KEY (as a replacement for session auth),
 * and coexisting with authPlugin would throw due to a duplicate AUTH_KEY.
 * The playground needs to demo both auth mechanisms side by side, so only JWT_AUTH_KEY is provided.
 */
export const jwtAuthPluginInstance: VobsPlugin = {
  name: 'playground:jwt-auth',
  version: '0.1.0',
  install(context) {
    context.provide(JWT_AUTH_KEY, jwtAuth)
  }
}

/** Mock protected API: returns 401 when the token is missing or expired. */
export async function callProtectedApi(token: string | null): Promise<string> {
  await delay(200)
  const payload = decodeToken(token)
  if (!payload || payload.exp * 1000 <= Date.now()) {
    throw Object.assign(new Error('401 Unauthorized: access token is missing or expired'), { status: 401 })
  }
  return `Protected data · sub=${payload.sub} · exp remaining ${Math.max(0, payload.exp * 1000 - Date.now())}ms`
}

/** Demonstrates 401 interception with replay: when a request fails with status 401, refresh the token once (single-flight) and replay the request. */
export async function fetchProtectedWithReplay(): Promise<string> {
  try {
    return await callProtectedApi(jwtAuth.getAccessToken())
  } catch (error) {
    if ((error as { status?: number }).status !== 401) throw error
    const token = await jwtAuth.refreshToken()
    return callProtectedApi(token)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
