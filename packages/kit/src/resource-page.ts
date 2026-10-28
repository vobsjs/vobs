import { effect, state } from '@vobs/reactivity'
import { useAuth, type AuthContext } from '@vobs/auth'
import { useI18n, type I18nContext } from '@vobs/i18n'
import { useRouter } from '@vobs/router'
import { KitDataTable, type KitDataTableProps } from '@vobs/table'
import { useTheme } from '@vobs/theme'
import {
  createComponent,
  createElement,
  createText,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { KitPage } from './page'
import { bindClassList, bindCommonAttributes, bindUserStyle, hasProp, readProp, resolveSlot } from './utils'
import type { KitResourcePageProps } from './types'

export function KitResourcePage<Row = Record<string, unknown>>(
  props: KitResourcePageProps<Row>
): VobsNode {
  const auth = props.auth ?? useAuth()
  const router = props.router ?? useRouter()
  const i18n = props.i18n ?? useI18n()
  const theme = props.theme ?? useTheme()
  const root = createElement('div')

  bindClassList(root, props, () => ['vobs-kit-resource-page'])
  bindCommonAttributes(root, props, [
    'resource', 'columns', 'title', 'description', 'actions', 'toolbar', 'tableProps', 'table',
    'requiredPermission', 'requiredRole', 'unauthorized', 'auth', 'router', 'i18n', 'theme',
    /*
     * The three below are **the framework's own diagnostic attributes**
     * (devtools/tests read them), written by this component's effect.
     * They used to be missing from this list → the generic-attribute channel
     * also wrote them (author `data-*` props with the same names came along),
     * so one attribute had two writers: overwritten by the real value first,
     * then "resurrected" to the author's value whenever another prop changed.
     * Same class of problem as ui's swallowed role — reserved for the
     * framework, the channel must not touch them.
     */
    'data-vobs-auth', 'data-vobs-route', 'data-vobs-theme'
  ])
  bindUserStyle(root, props)
  effect(() => {
    setAttribute(root, 'data-vobs-auth', auth.status.value)
    setAttribute(root, 'data-vobs-route', router.currentRoute.value.fullPath)
    setAttribute(root, 'data-vobs-theme', theme.resolvedMode.value)
  })
  /*
   * Carry the verdict in a **plain signal**, written only when the verdict
   * changes.
   *
   * The factory used to call `isAllowed(props, auth)` directly (which reads
   * `auth.session.value`) — so routine operations that don't change
   * permissions at all, like token refresh, rebuilt the whole
   * KitPage + KitDataTable (verified: the table jumped from page 2 back to
   * page 1).
   *
   * I first tried a `memo` guard, **verified ineffective**: probes showed vobs
   * memo is "mark dirty and propagate" (memo.ts:93-97); recomputation happens
   * lazily at read time and **does no value comparison**, so "equal derived
   * boolean → don't notify" doesn't hold under those semantics. A signal is
   * the opposite: writing an `Object.is`-equal value **doesn't notify**
   * (verified with the same probe). So use a signal.
   *
   * (The memo behavior is framework-level; changing it means touching its
   * propagation model — recorded in the backlog, out of scope here.)
   */
  const allowed = state(isAllowed(props, auth), 'allowed')
  effect(() => { allowed.value = isAllowed(props, auth) })
  insertDynamic(root, null, () => allowed.value
    ? createAuthorizedPage(props, i18n)
    : resolveSlot(readProp(props, 'unauthorized', undefined)) ?? createText(translate(i18n, 'auth.unauthorized', 'Unauthorized')))
  return root
}

function createAuthorizedPage<Row>(props: KitResourcePageProps<Row>, i18n: I18nContext): VobsNode {
  const tableProps = readProp<KitResourcePageProps<Row>['tableProps'] | undefined>(props, 'tableProps', undefined) ?? {}
  const table = hasProp(props, 'table')
    ? resolveSlot(readProp(props, 'table', undefined))
    : createComponent(KitDataTable<Row>, createTableProps(props, tableProps, i18n))
  return createComponent(KitPage, {
    get title() { return readProp(props, 'title', undefined) },
    get description() { return readProp(props, 'description', undefined) },
    get actions() { return readProp(props, 'actions', undefined) },
    get toolbar() { return readProp(props, 'toolbar', undefined) },
    children: table
  })
}

function createTableProps<Row>(
  props: KitResourcePageProps<Row>,
  tableProps: NonNullable<KitResourcePageProps<Row>['tableProps']>,
  i18n: I18nContext
): KitDataTableProps<Row> {
  const next = Object.create(tableProps) as KitDataTableProps<Row>
  Object.defineProperties(next, {
    columns: { enumerable: true, value: props.columns },
    resource: { enumerable: true, value: props.resource },
    loading: {
      enumerable: true,
      get: () => tableProps.loading ?? translate(i18n, 'common.loading', 'Loading...')
    },
    empty: {
      enumerable: true,
      get: () => tableProps.empty ?? translate(i18n, 'common.empty', 'No data')
    },
    error: {
      enumerable: true,
      get: () => tableProps.error ?? ((error: Error) => createText(error.message))
    }
  })
  return next
}

function translate(i18n: I18nContext, key: string, fallback: string): string {
  // The only way to detect a missing key used to be `value === key` guessing — a
  // translation **exactly equal to the key** was misjudged as missing and
  // clobbered by the fallback. i18n now provides a synchronous `has(key)`; just ask.
  return i18n.has(key) ? i18n.t(key) : fallback
}

function isAllowed<Row>(props: KitResourcePageProps<Row>, auth: AuthContext): boolean {
  if (props.requiredPermission && !auth.hasPermission(props.requiredPermission)) return false
  if (props.requiredRole && !auth.hasRole(props.requiredRole)) return false
  return Boolean(auth.session.value)
}
