# @vobs/table

Data table for vobs: client or server sorting, externally owned filters, pagination, column settings persistence, resource binding, and virtualized rows.

## Install

```bash
npm install @vobs/table
```

## Quick start

```ts
import { createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { KitDataTable } from '@vobs/table'
import type { DataTableColumn } from '@vobs/table'

setRenderer(createDOMRenderer())

interface User { id: number, name: string, role: string }

const columns: readonly DataTableColumn<User>[] = [
  { id: 'name', label: 'Name', key: 'name', sortable: true },
  { id: 'role', label: 'Role', key: 'role' }
]

const app = createVobs({
  render: () => KitDataTable<User>({
    columns,
    rows: [
      { id: 1, name: 'Ada', role: 'Admin' },
      { id: 2, name: 'Lin', role: 'Viewer' }
    ],
    pageSize: 1,
    onQueryChange: query => {
      // { page, pageSize, sort: { columnId, direction, sortKey? }, filters }
    }
  })
})

app.mount(document.getElementById('app')!)
```

## API

| Signature | Description |
| --- | --- |
| `KitDataTable<Row>(props: KitDataTableProps<Row>)` | Rows come from `rows` or a bound `resource`. Clicking a sortable header cycles asc, desc, then unsorted and emits the query through `onQueryChange`. `sortingMode: 'client'` reorders the loaded rows (`sortType`: text/number/date/boolean, `sortValue`, `compare`, null values last); `'server'` only emits the query including the column's `sortKey` and leaves row order untouched. Filtering is driven by the `filters` prop applied through per-column `filter` predicates — no filter inputs are rendered inside the table. Pagination uses `page`/`pageSize`/`total` and `paginationMode`; `stickyHeader` fixes the header; `virtual` enables windowed rows via `virtualHeight`/`rowHeight`/`overscan`. |
| `KitColumnSettings(props: KitColumnSettingsProps)` | Panel for column visibility, order, and widths. |
| `createColumnSettingsPersistence(storage, key)` | `DataTableColumnSettingsPersistence` over any `DataTableColumnSettingsStorage` (`get`/`set`/`remove`). |
| `createLocalColumnSettingsPersistence(key, storage?)` | Same interface over `localStorage`, falling back to in-memory storage. |
| `createDefaultColumnSettings(columns, visibleColumnIds?)` | Initial `DataTableColumnSettings` derived from column definitions. |
| `normalizeColumnSettings(columns, settings?, visibleColumnIds?)` | Drops unknown ids and repairs invalid settings against the columns. |

## Types

DataTableAlign, DataTableSortDirection, DataTableSortType, DataTableSortingMode, DataTablePaginationMode, DataTableSort, DataTableQuery, DataTablePage, DataTableResourceData, DataTableResource, DataTableChildren, DataTableColumn, DataTableColumnSettings, DataTableColumnSettingsPersistence, DataTableColumnSettingsStorage, DataTableIcons, DataTablePaginationContext, DataTablePagination, DataTableCommonProps, KitDataTableProps, KitColumnSettingsProps
