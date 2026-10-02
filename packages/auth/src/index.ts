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
 * 从 session 里取一个"字符串数组"字段 —— 形状不对就当**没有**（缺省拒绝）。
 *
 * 原来判定直接 `session.value?.user.permissions.includes(...)`，有两个坑：
 *  1. session 少了字段（水合不完整、`{}` 这种）就抛 TypeError —— 挂载期崩，**更新期被 effect 吞掉**，
 *     而吞掉之后旧的授权内容会留在页面上：最放行的路径恰恰是最安静的那条；
 *  2. 字段若是字符串，`.includes` 会退化成**子串匹配**（`roles: 'editor'` 让 `hasRole('e')` 为真）。
 * 所以只认字符串数组：不是就当空数组 → 一律拒绝。
 */
function readSessionList(session: Session | null, field: 'roles' | 'permissions'): readonly string[] {
  const user: unknown = session?.user
  if (!user || typeof user !== 'object') return []
  const value = (user as Record<string, unknown>)[field]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
export function createAuth<C extends Credentials = Credentials>(options: AuthOptions<C> = {}): AuthContext<C> {
  const ownedSession = options.session ? undefined : state<Session | null>(null)
  const session = options.session ?? ownedSession!
  const status = memo<AuthStatus>(() => session.value ? 'authenticated' : 'anonymous')
  /**
   * 世代计数：登出/销毁会推进它，此后落地的 in-flight 登录结果一律作废。
   * 照 resource 的 revision 模式（jwt-auth 的 `6736eaf` 是同一处修复）。
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
        throw new AuthError('LOGIN_NOT_CONFIGURED', 'Vobs Auth: 未配置 loginHandler')
      }
      const issued = generation
      const nextSession = await options.loginHandler(credentials)
      validateSession(nextSession)
      /*
       * 原来这里**无条件**写 session：await 期间用户点了登出（或上下文被销毁），
       * 登录结果一落地就把人重新登入 —— 一次"安全退出"被一个迟到的响应撤销。
       */
      if (disposed || generation !== issued) {
        throw new AuthError('LOGIN_SUPERSEDED', 'Vobs Auth: 登录结果已过期（期间发生了登出或销毁）')
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
        throw new AuthError('PERMISSION_DENIED', `Vobs Auth: 缺少权限 ${permission}`)
      }
    },

    requireRole(role: string): void {
      ensureActive()
      if (!context.hasRole(role)) {
        throw new AuthError('PERMISSION_DENIED', `Vobs Auth: 缺少角色 ${role}`)
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
    if (disposed) throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs Auth: 上下文已销毁')
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
    throw new AuthError('AUTH_CONTEXT_MISSING', 'Vobs Auth: 找不到上下文，请安装 authPlugin')
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
    // `[].every(...)` **恒真** → 空列表会把受保护内容放给任何人（含匿名）。空列表按"未满足"处理，
    // 与 RequireAnyPermission([])（`[].some` 恒假）结论一致：Guard 一律 fail closed。
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
    throw new AuthError('INVALID_SESSION', 'Vobs Auth: loginHandler 返回了无效 session')
  }
  const user = value.user
  if (typeof user.id !== 'string' || !Array.isArray(user.roles) || !Array.isArray(user.permissions)) {
    throw new AuthError('INVALID_SESSION', 'Vobs Auth: session.user 必须包含 id、roles 和 permissions')
  }
}
