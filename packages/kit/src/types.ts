import type {
  KitLayoutProps,
  LayoutChildren,
  LayoutCommonProps
} from '@vobs/layout'
import type { AuthContext } from '@vobs/auth'
import type { I18nContext } from '@vobs/i18n'
import type { Router } from '@vobs/router'
import type { ThemeContext } from '@vobs/theme'
import type {
  DataTableChildren,
  DataTableColumn,
  DataTableResource,
  KitDataTableProps
} from '@vobs/table'

export interface KitPageHeaderProps extends LayoutCommonProps {
  readonly title?: string
  readonly description?: string
  readonly actions?: LayoutChildren
}

export interface KitPageProps extends LayoutCommonProps {
  readonly header?: LayoutChildren
  readonly title?: string
  readonly description?: string
  readonly actions?: LayoutChildren
  /** Page-level controls such as search and filters, rendered outside the data table. */
  readonly toolbar?: LayoutChildren
}

export type KitLayoutOptions = KitLayoutProps

export interface KitResourcePageProps<Row = Record<string, unknown>> extends LayoutCommonProps {
  readonly resource: DataTableResource<Row>
  readonly columns: readonly DataTableColumn<Row>[]
  readonly title?: string
  readonly description?: string
  readonly actions?: LayoutChildren
  /** Page-level controls such as search and filters, rendered outside the data table. */
  readonly toolbar?: LayoutChildren
  readonly tableProps?: Omit<KitDataTableProps<Row>, 'resource' | 'columns'>
  readonly table?: DataTableChildren
  readonly requiredPermission?: string
  readonly requiredRole?: string
  readonly unauthorized?: DataTableChildren
  readonly auth?: AuthContext
  readonly router?: Router
  readonly i18n?: I18nContext
  readonly theme?: ThemeContext
}
