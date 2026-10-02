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

A conflict is decided once per local change. Once that change (same `id` and `timestamp`) has won against the remote, its `local` verdict is cached and a custom resolver is not called again on later cycles — even when the server keeps sending the same remote change. Only `local` verdicts are cached, and the cache is per instance (not persisted).

Convergence relies on `acknowledged` in the response: an ID list of what the server accepted, where an omitted field means every sent change is treated as accepted. When `acknowledged` is given explicitly, a local change listed there leaves the pending queue even if it just won the conflict, so it is not re-pushed every cycle. When `acknowledged` is omitted, a change that won the conflict stays pending and is re-sent each cycle (at-least-once).

`pollInterval` is fixed-cadence polling that calls `sync()`, not a backoff or retry policy — `SyncOptions` has no `retry`/`retryDelay`. After a failed cycle the next attempt still waits one full interval (the gap never grows), and without a `pollInterval` there is no automatic retry at all: schedule your own with the `error` event or `onError`.

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
