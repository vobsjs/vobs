# @vobs/sync

Offline-first data synchronization for vobs: a push/pull cycle with a persisted cursor and pending changes, configurable conflict resolution, and online/offline awareness.

## Install

```bash
npm install @vobs/sync
```

## Quick start

```ts
import { createSync, type SyncTransport } from '@vobs/sync'

const transport: SyncTransport = {
  sync: (payload, signal) =>
    fetch('/api/sync', { method: 'POST', body: JSON.stringify(payload), signal }).then(res => res.json())
}

const sync = createSync({
  transport,
  conflict: 'remote-wins', // or 'local-wins' or a (local, remote) resolver function
  onRemote: changes => applyToStore(changes)
})

sync.enqueue({ key: 'draft:1', operation: 'upsert', value: { title: 'Draft' } })
const result = await sync.sync()

result.pushed // number of local changes sent
result.pulled // number of remote changes applied
result.cursor // resume point for the next incremental cycle
```

Pending changes and the cursor persist through `@vobs/storage` (or a `StorageContext` you pass in), so a recreated instance resumes where the previous one stopped. When a remote change targets a key that also has a pending local change, `conflict` picks the winner; a custom resolver may return a merged change. Offline cycles fail with `SYNC_OFFLINE` and restart automatically on the browser `online` event. Cycles run as `@vobs/queue` tasks, one at a time.

## API

| Signature | Description |
| --- | --- |
| `createSync(options): SyncContext` | Options: `transport` (required), storage, queue, `conflict`, `incremental`, `pollInterval`, `onRemote`, `serialize`, `parse`, `onError`. |
| `sync.enqueue(change): SyncChange` | Record an upsert or delete; auto-syncs once started and online. |
| `sync.sync(): Promise<SyncResult>` | Run one push/pull cycle; concurrent calls share the active cycle. |
| `sync.start() / stop()` | Attach online listeners and `pollInterval` syncing, or stop them. |
| `sync.removePending(id) / clearPending()` | Drop unacknowledged local changes. |
| `sync.on(event, listener)` | Events: `start`, `done`, `error`, `online`, `offline`. |
| `sync.status / progress / pending / cursor / lastSyncAt / error / pendingChanges` | Reactive sync state. |
| `sync.dispose()` | Stop, cancel the active cycle, and release owned storage and queue. |
| `syncPlugin(options) / useSync()` | Provide and inject `SYNC_KEY` in a vobs app. |
| `SyncError` | Error with `code` such as `SYNC_OFFLINE`, `INVALID_RESPONSE`, `INVALID_CHANGE`, `SYNC_FAILED`. |

## Types

SyncStatus, SyncOperation, SyncCursor, SyncChange, SyncChangeInput, SyncConflictChoice, SyncConflictResolver, SyncRequest, SyncResponse, SyncTransport, SyncResult, SyncContext, SyncOptions, SyncPluginOptions, SyncEventMap, SyncEventName, SyncEventListener, SyncErrorCode
