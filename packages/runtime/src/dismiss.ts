import { createOwner, onDispose, untrack } from '@vobs/reactivity'

export type DismissEvent = 'mousedown' | 'pointerdown'

export interface DismissOptions {
  /** 监听的事件（默认 `mousedown`——与 @vobs/table rowMenu 等既有浮层一致）。 */
  readonly event?: DismissEvent
  /** 额外视为「内部」的节点（触发按钮等——点它不关闭，由它自己的 handler 决定开合）。 */
  readonly also?: readonly Node[]
  /** Escape 关闭（默认开启）。 */
  readonly escape?: boolean
  /**
   * 浮层**内部** mousedown 时 preventDefault（默认关闭）。
   *
   * 用途：菜单项按下时保持输入框焦点/选区不被移走（编辑菜单 execCommand 场景）——
   * preventDefault 阻止的是焦点转移，click 仍正常触发。浮层内部含输入框时勿开
   * （点击输入框将无法获得焦点）。
   */
  readonly keepFocusInside?: boolean
}

/**
 * 浮层「点外关闭」标准原语——把 Finora 死穴 §8 的两连坑变成**结构上写不出来**。
 *
 * ```ts
 * effect(() => {
 *   if (!open.value) return
 *   useDismiss(popupEl, () => { open.value = false })
 * })
 * ```
 *
 * ## 根治的两类坑（2026-10-24 实证，此前靠手写监听各自踩坑）
 *
 * 1. **菜单项点击全部无效**：手写 `document mousedown` capture 监听做「点外关闭」，
 *    点菜单项时捕获先于 click、立即 close() 把浮层 DOM 连根移除 → click 落死节点。
 *    本原语**内部命中即 return**——浮层内的 mousedown 永不触发关闭，菜单项由自身
 *    onclick 执行后自关。
 * 2. **编辑菜单 execCommand 全失效**：mousedown 默认行为把输入框焦点移走、选区清空。
 *    `keepFocusInside: true` 时浮层内 mousedown preventDefault（保焦点/选区）。
 *
 * ## 语义
 *
 * - 判定用 `contains`（含浮层自身）——与 @vobs/table rowMenu 弹层一致
 * - `close()` 在 **untrack** 里执行：回调内写信号不建立订阅（结构性免疫 C210）
 * - Escape 关闭默认开启（可关）
 * - 生命周期：内部自建 Owner，**自动挂到调用处的组件 Owner**（组件卸载级联清理）；
 *   close 触发后 Owner 自释放（浮层已关，监听不再需要）。重复 close 幂等
 */
export function useDismiss(popup: Node, close: () => void, options: DismissOptions = {}): void {
  const type: DismissEvent = options.event ?? 'mousedown'
  const also = options.also

  const owner = createOwner()
  let done = false
  const closeOnce = (): void => {
    if (done) return
    done = true
    owner.dispose()
    untrack(close)
  }

  owner.run(() => {
    const isInside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false
      if (popup.contains(target)) return true
      return also?.some(node => node.contains(target)) ?? false
    }

    const onDown = (event: Event): void => {
      if (isInside(event.target)) {
        if (options.keepFocusInside === true) event.preventDefault()
        return
      }
      closeOnce()
    }

    const onKeyDown = (event: Event): void => {
      if (options.escape === false) return
      if ((event as KeyboardEvent).key === 'Escape') closeOnce()
    }

    document.addEventListener(type, onDown, true)
    document.addEventListener('keydown', onKeyDown)
    onDispose(() => {
      document.removeEventListener(type, onDown, true)
      document.removeEventListener('keydown', onKeyDown)
    })
  })
}
