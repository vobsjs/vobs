import { createJWTAuth, JWT_AUTH_KEY } from '@vobs/jwt-auth'
import type { VobsPlugin } from '@vobs/vobs'
import { auth } from './auth'

/** Token 有效期（秒）：故意设置较短，方便观察过期、刷新和 401 重放。 */
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
  // 与 session auth 共享同一个 session 信号：JWT 登录后路由守卫同样放行。
  session: auth.session,
  transport: {
    async login(credentials) {
      await delay(300)
      const username = String(credentials.username ?? '').trim()
      if (!username) throw new Error('请输入用户名')
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
      if (!session) throw new Error('会话不存在，无法刷新 token')
      return { accessToken: issueToken(session.user.id.replace(/^jwt:/, '')) }
    }
  }
})

/**
 * jwtAuthPlugin 会同时提供 AUTH_KEY 和 JWT_AUTH_KEY（作为 session auth 的替代品），
 * 与 authPlugin 共存时会因 AUTH_KEY 重复而抛错。
 * Playground 需要演示两种认证方式并存，因此只提供 JWT_AUTH_KEY。
 */
export const jwtAuthPluginInstance: VobsPlugin = {
  name: 'playground:jwt-auth',
  version: '0.1.0',
  install(context) {
    context.provide(JWT_AUTH_KEY, jwtAuth)
  }
}

/** 模拟受保护 API：token 缺失或过期时返回 401。 */
export async function callProtectedApi(token: string | null): Promise<string> {
  await delay(200)
  const payload = decodeToken(token)
  if (!payload || payload.exp * 1000 <= Date.now()) {
    throw Object.assign(new Error('401 Unauthorized: access token 缺失或已过期'), { status: 401 })
  }
  return `受保护数据 · sub=${payload.sub} · exp 剩余 ${Math.max(0, payload.exp * 1000 - Date.now())}ms`
}

/** 演示 401 拦截重放：请求失败且状态码为 401 时，先单飞刷新 token 再重放一次。 */
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
