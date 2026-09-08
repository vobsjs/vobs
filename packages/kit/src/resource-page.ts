import { effect } from '@vobs/reactivity'
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
    'requiredPermission', 'requiredRole', 'unauthorized', 'auth', 'router', 'i18n', 'theme'
  ])
  bindUserStyle(root, props)
  effect(() => {
    setAttribute(root, 'data-vobs-auth', auth.status.value)
    setAttribute(root, 'data-vobs-route', router.currentRoute.value.fullPath)
    setAttribute(root, 'data-vobs-theme', theme.resolvedMode.value)
  })
  insertDynamic(root, null, () => isAllowed(props, auth)
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
  const value = i18n.t(key)
  return value === key ? fallback : value
}

function isAllowed<Row>(props: KitResourcePageProps<Row>, auth: AuthContext): boolean {
  if (props.requiredPermission && !auth.hasPermission(props.requiredPermission)) return false
  if (props.requiredRole && !auth.hasRole(props.requiredRole)) return false
  return Boolean(auth.session.value)
}
