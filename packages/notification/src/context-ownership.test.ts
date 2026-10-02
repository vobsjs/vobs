import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComponent, createText, createVobs, type VobsNode } from '@vobs/vobs'
import {
  NOTIFICATION_KEY,
  createNotification,
  notificationPlugin,
  type NotificationContext
} from './index'

/*
 * 契约：**谁创建 context，谁负责 dispose** —— 外部 context 不是缺陷，插件不许替调用方销毁。
 *
 * 报告（`.artifacts/reports/notification.md` §3.2，high）说 `index.ts:148`
 *   `if (getCurrentOwner()) onDispose(context.dispose)`
 * 只覆盖"创建时有 Owner"这条路径，而 `props.notification` / `notificationPlugin({ notification })`
 * 传入的外部 context 不会被收尾 —— 实测确实如此（下面第 1 条用例就是它的复现），但这是**所有权语义**，
 * 不是缺陷：
 *
 * - `index.ts:206-208`：`notificationPlugin` 只在**自己创建** context 时才返回清理函数
 *   （`options.notification ? undefined : createNotification(options)`），传入的外部对象一律不动手；
 *   同理 `props.notification`（ui/src/toast.ts:30）只是"用"，从不"销毁"。
 * - README:14-26 的主用法就是模块级 `const notification = createNotification()` + 自行
 *   `notification.dispose()`（README:38）—— 调用方自持、跨应用复用是**文档化的**用法；
 *   `packages/ui/src/toast.test.ts:71-80` 甚至依赖它：`app.destroy()` 之后拿同一个 context 再挂第二个应用。
 *   插件若在 `app.destroy()` 里替调用方销毁，这两个既有契约立刻同时崩。
 * - 报告那句"定时器仍写已卸载组件"经实测**不成立**：外部 context 的定时器到点只会调**调用方自己注册的**
 *   `onDismiss`，框架层面对已卸载宿主的 DOM 写入是 0（探针：宿主经 `insertDynamic` 卸载后 90ms 内
 *   MutationObserver 记录 3 → 3，没有任何新增变更，见下第 1 条用例同场景）。
 *
 * 所以本文件把所有权**钉死**在这三条上（而不是"咬住"某处待修代码）：外部 context 不随 app 销毁、
 * 插件自建 context 随 app 销毁、Owner 作用域内创建的 context 随该 Owner 销毁。
 * 谁把这行守卫改坏（例如让插件无条件 dispose `options.notification`），第 1 条就会红。
 */
describe('@vobs/notification context 所有权契约', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('外部 context 由调用方持有：app.destroy() 不收尾它（队列/定时器/可用性照旧）', () => {
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
    // 注入的就是调用方那个对象本身（不是副本）——所以"插件收尾"就等于"销毁调用方的对象"
    expect(injected).toBe(notification)

    app.destroy()

    // ① 没被清空：外部 context 的状态原样保留
    expect(notification.notifications.value).toHaveLength(1)
    // ② 定时器仍在：50ms 后按 timeout 收尾（报告 H6 的实测行为，这里是有意钉住的语义）
    vi.advanceTimersByTime(50)
    expect(dismissed).toEqual([['notification-1', 'timeout']])
    // ③ 仍然可用：没有被 NOTIFICATION_CONTEXT_DISPOSED 挡住（未被 dispose 的直接证据）
    expect(() => notification.info('after app destroy')).not.toThrow()
    expect(notification.notifications.value).toHaveLength(1)

    notification.dispose()
  })

  it('插件自建 context 由插件持有：app.destroy() 收尾（清定时器、回调 0 次、再用抛错）', () => {
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

    // dispose() 清掉定时器（index.ts:140-141），超时回调一次都不该再打
    vi.advanceTimersByTime(50)
    expect(reasons).toEqual([])
    expect(injected!.notifications.value).toHaveLength(0)
    expect(() => injected!.info('after app destroy')).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_DISPOSED' })
    )
  })

  it('Owner 作用域内创建的 context 随该 Owner 销毁（index.ts:148 那条路径）', () => {
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
    // 挂载期间可用，并留下一条 50ms 后本该超时收尾的待触发条目
    expect(() => scoped!.info('while mounted')).not.toThrow()
    expect(scoped!.notifications.value).toHaveLength(1)

    app.destroy() // 组件 Owner 一并销毁 → 第 148 行注册的 onDispose 跑起来

    vi.advanceTimersByTime(50)
    expect(reasons).toEqual([])
    expect(() => scoped!.info('after owner dispose')).toThrowError(
      expect.objectContaining({ code: 'NOTIFICATION_CONTEXT_DISPOSED' })
    )
  })
})
