# @vobs/dict

Business dictionaries (value/label lists) with TTL caching, per-name request dedup, and revision-based race protection.

## Install

```bash
npm install @vobs/dict
```

## Quick start

```ts
import { createDict } from '@vobs/dict'

const dict = createDict({
  data: { user_status: [{ value: 'active', label: 'Active' }] },
  loader: async (name, signal) => {
    const response = await fetch(`/api/dicts/${name}`, { signal })
    return response.json()
  },
  staleTime: 60_000
})

dict.label('user_status', 'active') // 'Active'

const query = dict.query('roles')
await query.load()
query.items.value // [{ value, label, ... }]
```

## API

| Signature | Description |
| --- | --- |
| `createDict(options?: DictOptions): DictContext` | Creates a dict context with optional static `data`, `loader`, `staleTime` (default 5 min), and `onError`. |
| `dict.data: Signal<DictData>` | Reactive map of dict name to items. |
| `dict.loading: Signal<boolean>` / `dict.error: Signal<Error | null>` | Global loading and error state. |
| `dict.get(name: DictName): DictItems` | Current items, or an empty array when unknown. |
| `dict.find(name: DictName, value: DictValue): DictItem | undefined` | Finds one item by value. |
| `dict.label(name: DictName, value: DictValue, fallback?): string` | Label for a value; falls back to the given string, then `String(value)`. |
| `dict.query(name: DictName): DictQuery` | Per-name view with `items`, `loading`, `error`, `updatedAt` signals plus `load()` and `invalidate()`. |
| `dict.load(name: DictName, options?): Promise<DictItems>` | Loads through the `loader`; skips while fresh unless `{ force: true }`. |
| `dict.set(name: DictName, items: DictItems): void` | Writes items directly and aborts any in-flight load. |
| `dict.invalidate(name?: DictName): void` | Marks one or all dicts stale and aborts in-flight requests. |
| `dict.dehydrate()` / `dict.hydrate(snapshot)` | Serializes and restores cached entries for SSR. |
| `dict.dispose(): void` | Aborts requests and disposes all signals. |
| `dictPlugin(options?): VobsPlugin` | Provides the context through `DICT_KEY`. |
| `useDict(): DictContext` | Injects the dict context inside components. |

Loads are deduplicated per name, and every load carries a revision: `invalidate()` or `set()` aborts the in-flight request through the `AbortSignal` and a late response from a superseded request can never overwrite newer data. Failed loads keep the previous items and surface a `DictError` on `query().error`.

## Types

`DictName`, `DictValue`, `DictItem`, `DictItems`, `DictData`, `DictLoader`, `DictQuery`, `DictOptions`, `DictPluginOptions`, `DictContext`, `DictDehydratedEntry`, `DictDehydratedState`, `DictErrorCode`
