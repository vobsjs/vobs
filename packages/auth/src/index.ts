import { getCurrentOwner, memo, onDispose, state, type ReadableSignal, type Signal } from '@vobs/reactivity'
import {
  createFragment,
  createInjectionKey,
  inject,
  insertDynamic,
  type InjectionKey,
  type VobsNode,
  type VobsPlugin
} from '@vobs/vobs'

export type Permission = string

export interface Role {
  readonly name: string
  readonly permissions: readonly Permission[]
}

export interface SessionUser {
  readonly id: string
  readonly roles: readonly string[]
  readonly permissions: readonly Permission[]
}

export interface Session {
  readonly user: SessionUser
  readonly [key: string]: unknown
}

export type Credentials = Record<string, unknown>
export type AuthStatus = 'anonymous' | 'authenticated'

export type AuthErrorCode =
  | 'AUTH_CONTEXT_MISSING'
  | 'LOGIN_NOT_CONFIGURED'
  | 'LOGIN_SUPERSEDED'
  | 'INVALID_SESSION'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'

export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

export interface AuthContext<C extends Credentials = Credentials> {
  readonly session: Signal<Session | null>
  readonly status: ReadableSignal<AuthStatus>
  hasPermission(permission: Permission): boolean
  hasRole(role: string): boolean
  login(credentials: C): Promise<void>
  logout(): void
  requirePermission(permission: Permission): void
  requireRole(role: string): void
  dispose(): void
}

export interface AuthOptions<C extends Credentials = Credentials> {
  readonly session?: Signal<Session | null>
  readonly loginHandler?: (credentials: C) => Session | PromiseLike<Session>
  readonly roles?: Readonly<Record<string, Role>>
  readonly permissions?: Readonly<Record<string, Permission>>
}

export interface AuthPluginOptions<C extends Credentials = Credentials> extends AuthOptions<C> {
  readonly auth?: AuthContext<C>
}

export const AUTH_KEY: InjectionKey<AuthContext> = createInjectionKey<AuthContext>('vobs.auth')

export interface AuthBoundaryProps {
  readonly fallback?: VobsNode | (() => VobsNode | null | undefined)
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
}

export interface RequirePermissionProps extends AuthBoundaryProps {
  readonly permission: Permission
}

export interface RequireRoleProps extends AuthBoundaryProps {
  readonly role: string
}

export interface RequirePermissionsProps extends AuthBoundaryProps {
  readonly permissions: readonly Permission[]
}

/**
 * Read a "string array" field from the session — treat a malformed shape as **absent** (deny by default).
 *
 * The original check was a direct `session.value?.user.permissions.includes(...)`, which had two pitfalls:
 *  1. If the session is missing fields (incomplete hydration, `{}`, etc.) it throws a TypeError — the crash
 *     lands during mount, but during updates it gets swallowed by an effect. After it is swallowed, the old
 *     authorized content stays on the page: the most permissive path is precisely the quietest one.
 *  2. If the field is a string, `.includes` degrades into **substring matching** (`roles: 'editor'` makes
 *     `hasRole('e')` true).
 * So only accept string arrays: anything else counts as an empty array → always deny.
 */
function readSessionList(session: Session | null, field: 'roles' | 'permissions'): readonly string[] {
  const user: unknown = session?.user
  if (!user || typeof user !== 'object') return []
  const value = (user as Record<string, unknown>)[field]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
export function createAuth<C extends Credentials = Credentials>(options: AuthOptions<C> = {}): AuthContext<C> {
  const ownedSession = options.session ? undefined : state<Session | null>(null, 'signal')
  const session = options.session ?? ownedSession!
  const status = memo<AuthStatus>(() => session.value ? 'authenticated' : 'anonymous')
  /**
   * Generation counter: logout/dispose advances it, and any in-flight login result landing afterwards
   * is discarded unconditionally. Follows the resource revision pattern (jwt-auth's `6736eaf` is the
   * same fix applied there).
   */
  let generation = 0
  let disposed = false

  const context: AuthContext<C> = {
    session,
    status,

    hasPermission(permission: Permission): boolean {
      if (disposed || !permission) return false
      return readSessionList(session.value, 'permissions').includes(permission)
    },

    hasRole(role: string): boolean {
      if (disposed || !role) return false
      return readSessionList(session.value, 'roles').includes(role)
    },

    async login(credentials: C): Promise<void> {
      ensureActive()
      if (!options.loginHandler) {
        throw new AuthError('LOGIN_NOT_CONFIGURED', 'Vobs Auth: loginHandler is not configured')
      }
      const issued = generation
      const nextSession = await options.loginHandler(credentials)
      validateSession(nextSession)
      /*
       * The original code wrote the session **unconditionally**: if the user clicked logout while the
       * await was pending (or the context was disposed), the login result would sign them right back in
       * the moment it landed — a "secure logout" silently undone by one late response.
       */
      if (disposed || generation !== issued) {
        throw new AuthError('LOGIN_SUPERSEDED', 'Vobs Auth: login result is stale (logout or dispose happened in the meantime)')
      }
      session.value = nextSession
    },

    logout(): void {
      ensureActive()
      generation++
      session.value = null
    },

    requirePermission(permission: Permission): void {
      ensureActive()
      if (!context.hasPermission(permission)) {
        throw new AuthError('PERMISSION_DENIED', `Vobs Auth: missing permission ${permission}`)
      }
    },

    requireRole(role: string): void {
      ensureActive()
      if (!context.hasRole(role)) {
        throw new AuthError('PERMISSION_DENIED', `Vobs Auth: missing role ${role}`)
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      status.dispose()
      ownedSession?.dispose()
    }
  }

  if (ownedSession && getCurrentOwner()) onDispose(context.dispose)
  return context

  function ensureActive(): void {
    if (disposed) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs Auth: context has been disposed')
  }
}

export function authPlugin<C extends Credentials = Credentials>(options: AuthPluginOptions<C> = {}): VobsPlugin {
  return {
    name: '@vobs/auth',
    version: '0.1.0',
    install(context) {
      const ownedAuth = options.auth ? undefined : createAuth(options)
      context.provide(AUTH_KEY, options.auth ?? ownedAuth!)
      return () => ownedAuth?.dispose()
    }
  }
}

export function useAuth(): AuthContext {
  const auth = inject(AUTH_KEY)
  if (!auth) {
    throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs Auth: context not found, install authPlugin first')
  }
  return auth
}

export function RequireAuth(props: AuthBoundaryProps = {}): VobsNode {
  return createAuthBoundary(useAuth, auth => Boolean(auth.session.value), props)
}

export function RequirePermission(props: RequirePermissionProps): VobsNode {
  return createAuthBoundary(useAuth, auth => auth.hasPermission(props.permission), props)
}

export function RequireRole(props: RequireRoleProps): VobsNode {
  return createAuthBoundary(useAuth, auth => auth.hasRole(props.role), props)
}

export function RequireAnyPermission(props: RequirePermissionsProps): VobsNode {
  return createAuthBoundary(
    useAuth,
    auth => props.permissions.some(permission => auth.hasPermission(permission)),
    props
  )
}

export function RequireAllPermissions(props: RequirePermissionsProps): VobsNode {
  return createAuthBoundary(
    useAuth,
    // `[].every(...)` is **always true** → an empty list would hand protected content to anyone
    // (including anonymous). Treat an empty list as "not satisfied", consistent with
    // RequireAnyPermission([]) (`[].some` is always false): guards always fail closed.
    auth => props.permissions.length > 0
      && props.permissions.every(permission => auth.hasPermission(permission)),
    props
  )
}

function createAuthBoundary(
  getAuth: () => AuthContext,
  allowed: (auth: AuthContext) => boolean,
  props: AuthBoundaryProps
): VobsNode {
  const auth = getAuth()
  return createFragment((parent, anchor) => {
    insertDynamic(parent, anchor, () => {
      const node = allowed(auth) ? props.children : props.fallback
      return typeof node === 'function' ? node() : node
    })
  })
}

function validateSession(value: Session): void {
  if (!value || typeof value !== 'object' || !value.user || typeof value.user !== 'object') {
    throw new AuthError('INVALID_SESSION', 'Vobs Auth: loginHandler returned an invalid session')
  }
  const user = value.user
  if (typeof user.id !== 'string' || !Array.isArray(user.roles) || !Array.isArray(user.permissions)) {
    throw new AuthError('INVALID_SESSION', 'Vobs Auth: session.user must contain id, roles and permissions')
  }
}
