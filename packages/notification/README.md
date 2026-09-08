# @vobs/notification

Reactive notification queue with typed helpers, auto-dismiss timers, same-id replacement, and overflow eviction.

## Install

```bash
npm install @vobs/notification
```

## Quick start

```ts
import { createNotification } from '@vobs/notification'

const notification = createNotification({ defaultDuration: 4500, maxNotifications: 5 })

const id = notification.error('Upload failed', {
  duration: 0, // sticky until dismissed
  onDismiss: (entry, reason) => {
    // reason: 'dismissed' | 'timeout' | 'replaced' | 'overflow' | 'cleared'
  }
})

notification.dismiss(id)
```

## API

| Signature | Description |
| --- | --- |
| `createNotification(options?: NotificationOptionsConfig): NotificationContext` | Creates a queue; `defaultDuration` defaults to 4500 ms and `maxNotifications` to 5. |
| `notification.notifications: Signal<readonly Notification[]>` | Reactive, frozen snapshot of active notifications. |
| `notification.notify(input: NotificationInput): string` | Adds a notification and returns its id. |
| `notification.info(content, options?)` / `success` / `warning` / `error` | Type-specific shorthands over `notify`. |
| `notification.dismiss(id: string, reason?): boolean` | Removes one notification; returns `false` when the id is unknown. |
| `notification.clear(reason?): void` | Removes every notification, defaulting to reason `'cleared'`. |
| `notification.dispose(): void` | Clears timers and the queue. |
| `notificationPlugin(options?): VobsPlugin` | Provides the context through `NOTIFICATION_KEY`. |
| `useNotification(): NotificationContext` | Injects the notification context inside components. |

The queue is capped at `maxNotifications`: adding beyond the cap dismisses the oldest entries with reason `'overflow'`, and notifying with an existing id replaces the old entry (`'replaced'`) and clears its timer. `duration: 0` disables auto-dismiss. Per-notification `onDismiss` and the global `onDismiss` option receive the entry and the reason; callbacks are isolated so they cannot corrupt queue state.

## Types

`Notification`, `NotificationInput`, `NotificationOptions`, `NotificationType`, `NotificationDismissReason`, `NotificationContext`, `NotificationOptionsConfig`, `NotificationPluginOptions`, `NotificationErrorCode`
