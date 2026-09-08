# @vobs/storage

Versioned key-value storage for vobs with a JSON envelope, cross-tab change events, migration, and automatic memory fallback.

## Install

```bash
npm install @vobs/storage
```

## Quick start

```ts
import { createStorage } from '@vobs/storage'

const storage = createStorage({
  storage: 'local', // 'local', 'session', 'memory', or a custom StorageLike
  prefix: 'myapp:',
  version: 2,
  migrate: (value, from, to) => (to === 2 ? { theme: value } : value)
})

storage.set('settings', { theme: 'dark' })
storage.get<{ theme: string }>('settings') // { theme: 'dark' }

const unsubscribe = storage.subscribe(change => {
  change.source // 'local' for own writes, 'external' for other tabs
})
```

Every value is written as an envelope carrying its version, so reads of older data run through `migrate` and are persisted back at the new version. Invalid JSON is reported as `CORRUPT_DATA`, removed, and reads return null. If the backend throws, the context degrades to the memory fallback and reports `STORAGE_UNAVAILABLE`. Writes from other tabs arrive through browser `storage` events with `source: 'external'`.

## API

| Signature | Description |
| --- | --- |
| `createStorage(options?: StorageOptions): StorageContext` | Options: backend, `fallback`, `prefix` (default `vobs:`), `version`, `migrate`, `onError`. |
| `storage.get(key) / set(key, value) / remove(key)` | JSON round-trip under the configured prefix. |
| `storage.has(key) / keys() / clear()` | Prefix-scoped inspection and cleanup. |
| `storage.subscribe(listener)` | Receives `{ key, value, source }`; returns an unsubscribe function. |
| `storage.kind / persistent / prefix / version` | Current backend kind (`local`, `session`, `memory`, `custom`) and configuration. |
| `storage.dispose()` | Stops listeners; further use of the context throws. |
| `createMemoryStorage() / memoryStorage` | In-memory `StorageLike` for tests and SSR. |
| `storagePlugin(options?)` | Provide the context as `STORAGE_KEY`; disposes it on uninstall. |
| `useStorage()` | Inject the context installed by `storagePlugin`. |
| `StorageError` | Error with `code` (`STORAGE_UNAVAILABLE`, `CORRUPT_DATA`, `SERIALIZATION_FAILED`, `MIGRATION_FAILED`), `key`, and `cause`. |

## Types

StorageType, StorageKind, StorageLike, StorageMigration, StorageOptions, StorageChange, StorageContext, StoragePluginOptions, StorageErrorCode
