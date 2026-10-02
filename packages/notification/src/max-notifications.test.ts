import { describe, expect, it } from 'vitest'
import { createNotification } from './index'

/*
 * 报告 notification §15.3 说 `maxNotifications: Infinity` 被"放行"是缺陷（实测 3000 条 → 长度 3000）。
 * 核实结论：**这是刻意的"不设上限"**，证据就是校验函数自己 ——
 * `validateMaxNotifications`（`index.ts:318-323`）写成
 *   `if (value !== Infinity && (!Number.isInteger(value) || value <= 0)) throw ...`
 * 连报错文案都写着"必须是正整数或 **或 Infinity**"。所以这条报告不成立（第 15 条不准确记录）。
 *
 * 这条用例的作用是把**契约**钉住：Infinity = 不设上限；有限值按上限裁剪且淘汰最旧的。
 * 免得以后有人"照报告修 bug"把它改成拒绝 Infinity —— 那会破坏一个公开选项的既有语义。
 */
describe('@vobs/notification maxNotifications 契约', () => {
  it('Infinity 表示不设上限', () => {
    const notification = createNotification({ maxNotifications: Infinity, defaultDuration: 0 })
    for (let index = 0; index < 30; index += 1) notification.info(`m${index}`)
    expect(notification.notifications.value).toHaveLength(30)
    notification.dispose()
  })

  it('有限值按上限裁剪，淘汰最旧的（reason 为 overflow）', () => {
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

  it('非法值仍然被拒（0 / 负数 / 小数）', () => {
    for (const value of [0, -1, 1.5]) {
      expect(() => createNotification({ maxNotifications: value }))
        .toThrowError(expect.objectContaining({ code: 'INVALID_MAX_NOTIFICATIONS' }))
    }
  })
})
