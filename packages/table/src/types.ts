import type { Signal } from '@vobs/reactivity'
import type { VobsNode } from '@vobs/vobs'

export type DataTableAlign = 'start' | 'center' | 'end'
export type DataTableSortDirection = 'asc' | 'desc'
export type DataTableSortType = 'text' | 'number' | 'date' | 'boolean'
export type DataTableSortingMode = 'client' | 'server'
export type DataTablePaginationMode = 'simple' | 'standard' | 'all'

export interface DataTableSort {
  readonly columnId: string
  readonly direction: DataTableSortDirection
  /** Optional backend field supplied by the column definition. */
  readonly sortKey?: string
}

export interface DataTableQuery {
  readonly page: number
  readonly pageSize: number
  readonly sort: DataTableSort | null
  readonly filters: Readonly<Record<string, unknown>>
}

export interface DataTablePage<Row> {
  readonly rows: readonly Row[]
  readonly total?: number
}

export type DataTableResourceData<Row> = readonly Row[] | DataTablePage<Row>

export interface DataTableResource<Row> {
  readonly data: { readonly value: DataTableResourceData<Row> | null }
  readonly error: { readonly value: Error | null }
  readonly loading: { readonly value: boolean }
  refetch(): Promise<unknown>
}

export type DataTableChildren =
  | VobsNode
  | string
  | number
  | readonly DataTableChildren[]
  | (() => DataTableChildren | null | undefined)

export interface DataTableColumn<Row = Record<string, unknown>> {
  readonly id: string
  readonly label: string
  readonly key?: keyof Row
  readonly render?: (row: Row, index: number) => DataTableChildren
  readonly compare?: (left: Row, right: Row) => number
  /** Value used by the built-in client sorter when compare is not provided. */
  readonly sortValue?: (row: Row) => unknown
  /** Optional value kind for deterministic client-side sorting. */
  readonly sortType?: DataTableSortType
  /** Backend field mapping; emitted together with the stable column id in DataTableSort. */
  readonly sortKey?: string
  /** Apply a filter value supplied by the page or another external filter control. */
  readonly filter?: (row: Row, value: unknown) => boolean
  readonly sortable?: boolean
  /** Marks a column as supported by an external filter UI; no control is rendered in the table. */
  readonly filterable?: boolean
  readonly visible?: boolean
  readonly align?: DataTableAlign
  readonly width?: string | number
  readonly minWidth?: string | number
}

export interface DataTableColumnSettings {
  readonly visibleColumnIds: readonly string[]
  readonly columnOrder: readonly string[]
  readonly columnWidths: Readonly<Record<string, string | number>>
}

export interface DataTableColumnSettingsPersistence {
  load(): DataTableColumnSettings | null | undefined
  save(settings: DataTableColumnSettings): void
  reset?(): void
}

/** Minimal storage shape accepted by createColumnSettingsPersistence. */
export interface DataTableColumnSettingsStorage {
  get<T>(key: string): T | null | undefined
  set<T>(key: string, value: T): void
  remove(key: string): void
}

export interface DataTableIcons {
  readonly ascending?: DataTableChildren
  readonly descending?: DataTableChildren
  readonly unsorted?: DataTableChildren
  readonly previous?: DataTableChildren
  readonly next?: DataTableChildren
}

export interface DataTablePaginationContext {
  readonly page: number
  readonly pageCount: number
  readonly pageSize: number
  readonly pageSizeOptions: readonly number[]
  readonly total: number
  readonly visibleCount: number
  readonly goToPage: (page: number) => void
  readonly setPageSize: (pageSize: number) => void
}

export type DataTablePagination =
  | DataTableChildren
  | ((context: DataTablePaginationContext) => DataTableChildren | null | undefined)

export interface DataTableCommonProps {
  readonly class?: string
  readonly className?: string
  readonly style?: string
  readonly id?: string
  readonly title?: string
  readonly role?: string
  readonly tabIndex?: number
  readonly [name: `aria-${string}`]: string | number | boolean | undefined
  readonly [name: `data-${string}`]: string | number | boolean | undefined
}

export interface KitDataTableProps<Row = Record<string, unknown>> extends DataTableCommonProps {
  readonly columns?: readonly DataTableColumn<Row>[]
  readonly rows?: readonly Row[]
  readonly resource?: DataTableResource<Row>
  readonly rowKey?: (row: Row, index: number) => unknown
  /** 传入 Signal 时受控分页：表格翻页后自动写回信号。 */
  readonly page?: number | Signal<number>
  readonly pageSize?: number | Signal<number>
  readonly total?: number
  readonly sort?: DataTableSort | null
  /** Client sorts loaded rows; server leaves row order to the resource owner. */
  readonly sortingMode?: DataTableSortingMode
  /** Query state is owned by the caller when provided and is never edited by table-owned inputs. */
  readonly filters?: Readonly<Record<string, unknown>>
  readonly columnSettings?: DataTableColumnSettings
  readonly visibleColumnIds?: readonly string[]
  readonly virtual?: boolean
  readonly stickyHeader?: boolean
  readonly virtualHeight?: number
  readonly rowHeight?: number
  readonly overscan?: number
  readonly loading?: DataTableChildren
  readonly empty?: DataTableChildren
  readonly error?: (error: Error, retry: () => Promise<unknown>) => DataTableChildren
  readonly toolbar?: DataTableChildren
  readonly footer?: DataTableChildren
  readonly pagination?: DataTablePagination
  readonly paginationMode?: DataTablePaginationMode
  readonly pageSizeOptions?: readonly number[]
  readonly pageSizeLabel?: string
  readonly icons?: DataTableIcons
  readonly previousLabel?: string
  readonly nextLabel?: string
  readonly jumpToLabel?: string
  readonly jumpToPlaceholder?: string
  readonly jumpToSubmitLabel?: string
  /** Formats the footer summary. The last two arguments are visible row count and page size. */
  readonly pageLabel?: (
    page: number,
    pageCount: number,
    total: number,
    visibleCount: number,
    pageSize: number
  ) => string
  /** Receives table-originated sort and pagination changes for a page-level query controller. */
  readonly onQueryChange?: (query: DataTableQuery) => void
  readonly onRowClick?: (row: Row, index: number) => void
  readonly onVisibleColumnIdsChange?: (ids: readonly string[]) => void
}

export interface KitColumnSettingsProps<Row = Record<string, unknown>> extends DataTableCommonProps {
  readonly columns?: readonly DataTableColumn<Row>[]
  readonly settings?: DataTableColumnSettings
  readonly persistence?: DataTableColumnSettingsPersistence
  readonly visibleColumnIds?: readonly string[]
  readonly trigger?: DataTableChildren
  readonly label?: string
  readonly closeLabel?: string
  readonly resetLabel?: string
  readonly onChange?: (ids: readonly string[]) => void
  readonly onSettingsChange?: (settings: DataTableColumnSettings) => void
  readonly onReset?: () => void
  readonly onPersistenceError?: (error: unknown) => void
}
