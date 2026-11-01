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

## Grouped header

Declare `group` on **leaf columns**. Contiguous visible columns sharing the same `group.id`
merge into one row-1 cell with `colspan` (the group label); row 2 keeps the usual per-column
header (label / `head` / sort button).

```ts
const columns: readonly DataTableColumn<Sale>[] = [
  { id: 'customer', label: 'Customer' },
  { id: 'vatAmount', label: 'Amount', sortable: true, group: { id: 'vat', label: 'VAT' } },
  { id: 'vatStatus', label: 'Status', group: { id: 'vat', label: 'VAT' } }
]
```

- The column model stays **flat**: sorting, visibility, column order, width settings and cell
  rendering are unchanged — grouping is purely a header concern.
- Ungrouped columns span both header rows (`rowspan=2`), so the two-row header stays rectangular.
- Contiguity is computed **after** visibility/order normalization: hiding a leaf shrinks the
  group's `colspan`; hiding a middle column **splits** one group into two group cells (the label
  repeats — columns are never silently rejoined).
- Group labels may be a string, node, or factory (a factory re-renders reactively, like `head`).
  `group.align` (`'start' | 'center' | 'end'`) defaults to centered.
- With `stickyHeader`, the leaf row is pushed below the group row by the **measured** group-row
  height (`--vobs-table-group-head-height`), so app-level header padding overrides stay aligned.

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

DataTableAlign, DataTableSortDirection, DataTableSortType, DataTableSortingMode, DataTablePaginationMode, DataTableSort, DataTableQuery, DataTablePage, DataTableResourceData, DataTableResource, DataTableChildren, DataTableColumn, DataTableColumnGroup, DataTableColumnSettings, DataTableColumnSettingsPersistence, DataTableColumnSettingsStorage, DataTableIcons, DataTablePaginationContext, DataTablePagination, DataTableCommonProps, KitDataTableProps, KitColumnSettingsProps
