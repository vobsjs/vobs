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
  const accessToken = state<string | null>(null, 'accessToken')
  const baseAuth = createAuth<C>({
    session: options.session,
    loginHandler: async credentials => {
      const issued = generation
      const result = await options.transport.login(credentials)
      validateLoginResult(result)
      /*
       * A login landing after logout/dispose **must not be written back** — otherwise a "user who
       * already signed out" gets resurrected (security level).
       * Measured: letting an in-flight login through after logout flipped the session back to
       * signed-in.
       */
      if (generation !== issued || disposed) {
        throw new Error('Vobs JWT Auth: login result is stale (logout or dispose happened in the meantime)')
      }
      accessToken.value = result.accessToken
      return { user: result.user }
    }
  })
  let refreshing: Promise<string> | null = null
  let refreshingGeneration = -1
  /** Generation counter: logout/dispose advances it; in-flight results landing afterwards are discarded (resource's revision pattern). */
  let generation = 0
  let disposed = false
  /*
   * Grab the **underlying auth's dispose** first.
   *
   * The `Object.assign(baseAuth, {...})` below mutates `baseAuth` itself — so `baseAuth.dispose()`
   * becomes a **self-call**: `:97` sets `disposed = true`, the guard on `:96` returns immediately,
   * and the original implementation is never reached — **the underlying createAuth is never
   * disposed** (measured: after app.destroy() login() still succeeded and hasPermission stayed true).
   * The existing tests happened to only assert getAccessToken(), which still throws → false green.
   */
  const baseDispose = baseAuth.dispose.bind(baseAuth)

  const jwtAuth = Object.assign(baseAuth, {
    accessToken,

    getAccessToken(): string | null {
      ensureActive()
      return accessToken.value
    },

    async refreshToken(): Promise<string> {
      ensureActive()
      // Restart when the generation changed: otherwise a new call after logout would reuse the
      // in-flight promise from **before** the logout
      if (!refreshing || refreshingGeneration !== generation) {
        const issued = generation
        refreshingGeneration = issued
        refreshing = (async () => options.transport.refresh())()
          .then(result => {
            validateRefreshResult(result)
            if (generation !== issued || disposed) {
              throw new Error('Vobs JWT Auth: refresh result is stale (logout or dispose happened in the meantime)')
            }
            accessToken.value = result.accessToken
            if (result.user) baseAuth.session.value = { user: result.user }
            return result.accessToken
          })
          .catch(error => {
            // A stale failure **must not** clear the new round's session
            if (generation === issued && !disposed) clearSession()
            reportFailure(error)
            throw error
          })
          .finally(() => {
            if (refreshingGeneration === issued) {
              refreshing = null
              refreshingGeneration = -1
            }
          })
      }
      return refreshing
    },

    async logout(): Promise<void> {
      ensureActive()
      // Advance the generation: login/refresh results landing afterwards are discarded (no
      // resurrection, and the new round's session is not cleared either)
      generation++
      refreshing = null
      refreshingGeneration = -1
      try { await options.transport.logout?.() }
      finally { clearSession() }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      accessToken.dispose()
      baseDispose()      // not baseAuth.dispose() — that would be a self-call (see baseDispose above)
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
    if (disposed) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: context has been disposed')
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
        throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: either transport or auth must be provided')
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
  if (!auth) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs JWT Auth: context not found, install jwtAuthPlugin first')
  return auth
}

function validateOptions<C extends Credentials>(options: JWTAuthOptions<C>): void {
  if (!options || !options.transport
    || typeof options.transport.login !== 'function'
    || typeof options.transport.refresh !== 'function') {
    throw new AuthError('INVALID_SESSION', 'Vobs JWT Auth: transport must provide login and refresh')
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
  return new AuthError('INVALID_SESSION', 'Vobs JWT Auth: transport returned an invalid result')
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
