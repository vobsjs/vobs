import { state, type Signal } from '@vobs/reactivity'
import {
  AUTH_KEY,
  AuthError,
  createAuth,
  type AuthContext,
  type Credentials,
  type Session,
  type SessionUser
} from '@vobs/auth'
import { createInjectionKey, inject, type InjectionKey, type VobsPlugin } from '@vobs/vobs'

export interface JWTLoginResult {
  readonly accessToken: string
  readonly user: SessionUser
}

export interface JWTRefreshResult {
  readonly accessToken: string
  readonly user?: SessionUser
}

export interface JWTAuthTransport<C extends Credentials = Credentials> {
  login(credentials: C): JWTLoginResult | PromiseLike<JWTLoginResult>
  refresh(): JWTRefreshResult | PromiseLike<JWTRefreshResult>
  logout?(): void | PromiseLike<void>
}

export interface JWTAuthOptions<C extends Credentials = Credentials> {
  readonly transport: JWTAuthTransport<C>
  readonly session?: Signal<Session | null>
  readonly onAuthFailure?: (error: unknown) => void
}

export interface JWTAuthContext<C extends Credentials = Credentials> extends AuthContext<C> {
  readonly accessToken: Signal<string | null>
  refreshToken(): Promise<string>
  getAccessToken(): string | null
  logout(): Promise<void>
}

export const JWT_AUTH_KEY: InjectionKey<JWTAuthContext> = createInjectionKey<JWTAuthContext>('vobs.jwt-auth')

export function createJWTAuth<C extends Credentials = Credentials>(
  options: JWTAuthOptions<C>
): JWTAuthContext<C> {
  validateOptions(options)
  const accessToken = state<string | null>(null)
  const baseAuth = createAuth<C>({
    session: options.session,
    loginHandler: async credentials => {
      const result = await options.transport.login(credentials)
      validateLoginResult(result)
      accessToken.value = result.accessToken
      return { user: result.user }
    }
  })
  let refreshing: Promise<string> | null = null
  let disposed = false

  const jwtAuth = Object.assign(baseAuth, {
    accessToken,

    getAccessToken(): string | null {
      ensureActive()
      return accessToken.value
    },

    async refreshToken(): Promise<string> {
      ensureActive()
      if (!refreshing) {
        refreshing = (async () => options.transport.refresh())()
          .then(result => {
            validateRefreshResult(result)
            accessToken.value = result.accessToken
            if (result.user) baseAuth.session.value = { user: result.user }
            return result.accessToken
          })
          .catch(error => {
            clearSession()
            reportFailure(error)
            throw error
          })
          .finally(() => { refreshing = null })
      }
      return refreshing
    },

    async logout(): Promise<void> {
      ensureActive()
      try { await options.transport.logout?.() }
      finally { clearSession() }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      accessToken.dispose()
      baseAuth.dispose()
    }
  }) as JWTAuthContext<C>

  return jwtAuth

  function clearSession(): void {
    accessToken.value = null
    baseAuth.session.value = null
  }

  function reportFailure(error: unknown): void {
    try { options.onAuthFailure?.(error) } catch { /* observers cannot mask auth failure */ }
  }

  function ensureActive(): void {
    if (disposed) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: 上下文已销毁')
  }
}

export interface JWTAuthPluginOptions<C extends Credentials = Credentials> {
  readonly transport?: JWTAuthTransport<C>
  readonly auth?: JWTAuthContext<C>
  readonly onAuthFailure?: (error: unknown) => void
}

export function jwtAuthPlugin<C extends Credentials = Credentials>(
  options: JWTAuthPluginOptions<C> = {}
): VobsPlugin {
  return {
    name: '@vobs/jwt-auth',
    version: '0.1.0',
    install(context) {
      if (!options.auth && !options.transport) {
        throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: 必须传入 transport 或 auth')
      }
      const ownedAuth = options.auth ? undefined : createJWTAuth({
        transport: options.transport!,
        onAuthFailure: options.onAuthFailure
      })
      const auth = options.auth ?? ownedAuth!
      context.provide(AUTH_KEY, auth)
      context.provide(JWT_AUTH_KEY, auth)
      return () => ownedAuth?.dispose()
    }
  }
}

export function useJWTAuth(): JWTAuthContext {
  const auth = inject(JWT_AUTH_KEY)
  if (!auth) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: 找不到上下文，请安装 jwtAuthPlugin')
  return auth
}

function validateOptions<C extends Credentials>(options: JWTAuthOptions<C>): void {
  if (!options || !options.transport
    || typeof options.transport.login !== 'function'
    || typeof options.transport.refresh !== 'function') {
    throw new AuthError('INVALID_SESSION', 'Vobs JWT Auth: transport 必须提供 login 和 refresh')
  }
}

function validateLoginResult(value: JWTLoginResult): void {
  if (!value || typeof value !== 'object') throw invalidResult()
  validateToken(value.accessToken)
  validateUser(value.user)
}

function validateRefreshResult(value: JWTRefreshResult): void {
  if (!value || typeof value !== 'object') throw invalidResult()
  validateToken(value.accessToken)
  if (value.user !== undefined) validateUser(value.user)
}

function invalidResult(): AuthError {
  return new AuthError('INVALID_SESSION', 'Vobs JWT Auth: transport 返回了无效结果')
}

function validateToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !token) throw invalidResult()
}

function validateUser(user: unknown): asserts user is SessionUser {
  if (!user || typeof user !== 'object') throw invalidResult()
  const candidate = user as Partial<SessionUser>
  if (typeof candidate.id !== 'string' || !Array.isArray(candidate.roles) || !Array.isArray(candidate.permissions)) {
    throw invalidResult()
  }
}
