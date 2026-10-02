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
     * 下面这三个是**框架自己的诊断属性**（devtools/测试会读），由本组件那个 effect 写。
     * 原来没列在这里 → 通用属性通道也会写它们（作者 props 里同名的 data-* 会跟进来），
     * 于是同一个属性有两个写入者：先被真实值覆盖、等别的 prop 变化时"复活"成作者的值。
     * 与 ui 的 role 被吞是同一类问题 —— 保留给框架，通道不许碰。
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
   * 判定结论用**普通 signal** 承载，只在结论变化时写入。
   *
   * 原来工厂直接调 `isAllowed(props, auth)`（它读 `auth.session.value`）—— 于是 token 刷新这种
   * 权限完全没变的日常操作也会把 KitPage + KitDataTable 整个重建（实测表格从第 2 页弹回第 1 页）。
   *
   * 我先试过 `memo` 挡，**实测无效**：探针证明 vobs 的 memo 是"标脏即传播"（memo.ts:93-97），
   * 重算在取值时惰性发生且**不做值比较**，所以"派生布尔值相等就不通知"在这套语义下不成立。
   * signal 相反：写入 `Object.is` 相等的值**不通知**（同一探针验证过）。所以用 signal。
   *
   * （memo 那条是框架级行为，要改得动它的传播模型 —— 已记入待办，不在本次范围。）
   */
  const allowed = state(isAllowed(props, auth))
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
  // 原来只能靠 `value === key` 猜"是不是缺 key" —— 译文**恰好等于 key** 时会被误判成缺失、
  // 被 fallback 顶掉。i18n 现在提供同步的 `has(key)`，直接问就行。
  return i18n.has(key) ? i18n.t(key) : fallback
}

function isAllowed<Row>(props: KitResourcePageProps<Row>, auth: AuthContext): boolean {
  if (props.requiredPermission && !auth.hasPermission(props.requiredPermission)) return false
  if (props.requiredRole && !auth.hasRole(props.requiredRole)) return false
  return Boolean(auth.session.value)
}
