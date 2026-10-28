import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createText, createVobs, type VobsNode } from '@vobs/vobs'
import {
  NOTIFICATION_KEY,
  createNotification,
  notificationPlugin,
  type NotificationContext
} from './index'

/*
 * Contract: **whoever creates the context is responsible for disposing it** — an external
 * context is not a defect, and the plugin must not dispose it on the caller's behalf.
 *
 * A report (`.artifacts/reports/notification.md` §3.2, high) claims that `index.ts:148`
 *   `if (getCurrentOwner()) onDispose(context.dispose)`
 * only covers the "owner present at creation" path, and that an external context passed via
 * `props.notification` / `notificationPlugin({ notification })` never gets finalized —
 * measured, that is indeed the case (test 1 below reproduces it), but this is **ownership
 * semantics**, not a defect:
 *
 * - `index.ts:206-208`: `notificationPlugin` only returns a cleanup function when it
 *   **created the context itself** (`options.notification ? undefined : createNotification(options)`);
 *   an externally passed object is never touched. Same for `props.notification`
 *   (ui/src/toast.ts:30) — it only "uses", never "destroys".
 * - The main usage in README:14-26 is a module-level `const notification = createNotification()`
 *   plus an explicit `notification.dispose()` (README:38) — caller-owned, reused across apps is
 *   a **documented** usage; `packages/ui/src/toast.test.ts:71-80` even relies on it: after
 *   `app.destroy()` it mounts a second app with the same context. If the plugin disposed the
 *   caller's context inside `app.destroy()`, both existing contracts would break at once.
 * - The report's claim that "timers still write into unmounted components" is **not true** per
 *   measurement: an external context's timer, when it fires, only calls the **caller's own**
 *   `onDismiss`; framework-level DOM writes into an unmounted host are 0 (probe: within 90ms
 *   after the host was unmounted via `insertDynamic`, MutationObserver recorded 3 → 3 — no new
 *   mutations; same scenario as test 1 below).
 *
 * So this file **pins** ownership with these three tests (not by "biting" some code awaiting a
 * fix): an external context survives app destruction, a plugin-created context dies with the
 * app, and a context created inside an Owner scope dies with that Owner.
 * If anyone breaks that guard line (e.g. making the plugin unconditionally dispose
 * `options.notification`), test 1 turns red.
 */
describe('@vobs/notification context ownership contract', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('external context is caller-owned: app.destroy() does not finalize it (queue/timers/usability intact)', () => {
    vi.useFakeTimers()
    const notification = createNotification({ defaultDuration: 50 })
    const dismissed: Array<[string, string]> = []
    notification.info('pending', {
      onDismiss: (entry, reason) => { dismissed.push([entry.id, reason]) }
    })

    let injected: NotificationContext | undefined
    const app = createVobs({
      render: () => createText('host'),
      plugins: [
        notificationPlugin({ notification }),
        { name: 'consumer', install(context) { injected = context.inject(NOTIFICATION_KEY) } }
      ]
    })
    app.mount(document.createElement('div'))
    // what gets injected is the caller's object itself (not a copy) — so "plugin finalizes" would equal "destroy the caller's object"
    expect(injected).toBe(notification)

    app.destroy()

    // (1) not cleared: the external context's state is preserved as-is
    expect(notification.notifications.value).toHaveLength(1)
    // (2) timer still alive: finalizes with timeout after 50ms (the measured behavior of report H6; semantics pinned here on purpose)
    vi.advanceTimersByTime(50)
    expect(dismissed).toEqual([['notification-1', 'timeout']])
    // (3) still usable: not blocked by NOTIFICATION_CONTEXT_DISPOSED (direct evidence it was never disposed)
    expect(() => notification.info('after app destroy')).not.toThrow()
    expect(notification.notifications.value).toHaveLength(1)

    notification.dispose()
  })

  it('plugin-created context is plugin-owned: app.destroy() finalizes it (timers cleared, 0 callbacks, further use throws)', () => {
    vi.useFakeTimers()
    const reasons: string[] = []
    let injected: NotificationContext | undefined
    const app = createVobs({
      render: () => createText('host'),
      plugins: [
        notificationPlugin({
          defaultDuration: 50,
          onDismiss: (_entry, reason) => { reasons.push(reason) }
        }),
        { name: 'consumer', install(context) { injected = context.inject(NOTIFICATION_KEY) } }
      ]
    })
    app.mount(document.createElement('div'))
    injected!.info('pending')
    expect(injected!.notifications.value).toHaveLength(1)

    app.destroy()

    // dispose() clears the timers (index.ts:140-141); the timeout callback must not fire at all
    vi.advanceTimersByTime(50)
    expect(reasons).toEqual([])
    expect(injected!.notifications.value).toHaveLength(0)
    expect(() => injected!.info('after app destroy')).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_DISPOSED' })
    )
  })

  it('a context created inside an Owner scope dies with that Owner (the index.ts:148 path)', () => {
    vi.useFakeTimers()
    const reasons: string[] = []
    let scoped: NotificationContext | undefined
    function Scoped(): VobsNode {
      scoped = createNotification({
        defaultDuration: 50,
        onDismiss: (_entry, reason) => { reasons.push(reason) }
      })
      return createText('scoped')
    }

    const app = createVobs({ render: () => createComponent(Scoped, {}) })
    app.mount(document.createElement('div'))
    // usable while mounted, leaving one entry that would time out after 50ms
    expect(() => scoped!.info('while mounted')).not.toThrow()
    expect(scoped!.notifications.value).toHaveLength(1)

    app.destroy() // the component Owner is destroyed too → the onDispose registered at line 148 runs

    vi.advanceTimersByTime(50)
    expect(reasons).toEqual([])
    expect(() => scoped!.info('after owner dispose')).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_DISPOSED' })
    )
  })
})
