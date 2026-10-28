import { describe, expect, it } from 'vitest'
import { createNotification } from './index'

/*
 * Report notification §15.3 claims `maxNotifications: Infinity` being "allowed through" is a
 * defect (measured: 3000 entries → length 3000).
 * Verification conclusion: **this is a deliberate "no upper bound"**, and the evidence is the
 * validator itself —
 * `validateMaxNotifications` (`index.ts:318-323`) is written as
 *   `if (value !== Infinity && (!Number.isInteger(value) || value <= 0)) throw ...`
 * even the error copy says "must be a positive integer **or Infinity**". So the report does not
 * hold (item 15 is an inaccurate record).
 *
 * This test pins the **contract**: Infinity = no upper bound; finite values are trimmed to the
 * cap with the oldest evicted.
 * That way nobody later "fixes the bug per the report" by rejecting Infinity — which would
 * break the established semantics of a public option.
 */
describe('@vobs/notification maxNotifications contract', () => {
  it('Infinity means no upper bound', () => {
    const notification = createNotification({ maxNotifications: Infinity, defaultDuration: 0 })
    for (let index = 0; index < 30; index += 1) notification.info(`m${index}`)
    expect(notification.notifications.value).toHaveLength(30)
    notification.dispose()
  })

  it('finite values are trimmed to the cap, evicting the oldest (reason overflow)', () => {
    const reasons: string[] = []
    const notification = createNotification({
      maxNotifications: 3,
      defaultDuration: 0,
      onDismiss: (_entry, reason) => { reasons.push(reason) }
    })
    for (let index = 0; index < 5; index += 1) notification.info(`m${index}`)

    expect(notification.notifications.value).toHaveLength(3)
    expect(notification.notifications.value.map(entry => entry.content)).toEqual(['m2', 'm3', 'm4'])
    expect(reasons.filter(reason => reason === 'overflow')).toHaveLength(2)
    notification.dispose()
  })

  it('invalid values are still rejected (0 / negative / fractional)', () => {
    for (const value of [0, -1, 1.5]) {
      expect(() => createNotification({ maxNotifications: value }))
        .toThrowError(expect.objectContaining({ code: 'INVALID_MAX_NOTIFICATIONS' }))
    }
  })
})
