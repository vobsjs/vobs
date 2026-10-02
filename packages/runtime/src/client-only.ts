import { getCurrentOwner, state } from '@vobs/reactivity'
import { insertDynamic } from './dynamic'
import { createFragment, type VobsNode } from './fragment'

export interface ClientOnlyProps {
  /** 只在客户端渲染的内容。 */
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
  /** 服务端（以及水合首轮）渲染的占位。 */
  readonly fallback?: VobsNode | (() => VobsNode | null | undefined)
}

/**
 * `<ClientOnly>` —— 只在客户端渲染的子树。
 *
 * 补的是外部踩坑文档 D 条的后一半：`onMount`（`39c155b`）管**副作用**
 * （定时器 / matchMedia / localStorage），`ClientOnly` 管**渲染** ——
 * 某些子树在服务端根本渲染不出来（依赖 `window`、第三方 widget、需要真实布局测量）。
 *
 * ## 为什么必须是**两阶段**（这是这个组件唯一需要想清楚的地方）
 *
 * 朴素实现是"服务端渲染空、客户端渲染 children" —— **那会造成水合不匹配**：
 * 服务端产物里没有那棵子树，客户端却期望认领它（本仓库严格水合会报 `missing-node`，
 * 非严格模式也会静默重建，表现为内容闪烁）。
 *
 * 所以这里：
 * 1. **首轮**：服务端与客户端**都**渲染 `fallback`（默认什么都不渲染）—— 对得上
 * 2. **挂载之后**（微任务）：翻成"已就绪"，`insertDynamic` 换入 `children`
 *
 * ## 父节点从哪来
 *
 * 用 `createFragment` —— 它的工厂签名是 `(parent, anchor) => void`，
 * **框架在挂载时把父节点与锚点交进来**，于是可以直接用 `insertDynamic` 换内容，
 * 不需要包裹元素（包裹层会改 flex/grid 布局）。
 *
 * ## 边界（如实说明）
 *
 * 客户端判定用的是 `typeof document === 'undefined'`，与 `onMount`（`39c155b`）
 * 以及 `@vobs/ssr` 的 `prerender.ts` **同一套判据**。其已知局限也一样：
 * **在 jsdom 这类带 DOM 的环境里做预渲染时会被判成客户端**（框架目前没有"正在预渲染"标志）。
 * 那种环境下 `ClientOnly` 的首轮会渲染 `fallback`、微任务里再换成 `children`，
 * 水合仍然是对得上的（两侧首轮一致），只是"跳过客户端渲染"这件事没生效。
 */
export function ClientOnly(props: ClientOnlyProps = {}): VobsNode {
  return createFragment((parent, anchor) => {
    const ready = state(false)
    /*
     * 只有存在 `document` 才排这个微任务 —— Node 端预渲染时不应留下会稍后执行的副作用
     * （那会让"服务端渲染"在 renderToString 返回之后还动到已完成的输出）。
     */
    if (typeof document !== 'undefined') {
      const owner = getCurrentOwner()
      queueMicrotask(() => {
        // 组件在这之前被卸载 → 不再翻转（与 onMount 同一防御）
        if (owner?.disposed) return
        ready.value = true
      })
    }
    insertDynamic(parent, anchor, () => {
      const slot = ready.value ? props.children : props.fallback
      // 用 unknown 承接：声明类型不含 false，但 `cond && <X/>` 会给出 false
      const value: unknown = typeof slot === 'function' ? slot() : slot
      return value === undefined || value === null || value === false ? null : (value as VobsNode)
    })
  })
}
