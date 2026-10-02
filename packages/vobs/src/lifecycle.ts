import { getCurrentOwner, onDispose, type Owner } from '@vobs/reactivity'

/**
 * 组件/作用域**卸载前**跑一次清理（与 `onMount` 配成一套）。
 *
 * 外部踩坑文档 D 条里反复提到"定时器/监听**没有正式的清理位置**，清理只能靠约定" ——
 * 那说的其实就是这个 API 的缺失。这里把它补成**标准名字**。
 *
 * ## 与 `onDispose` 的关系（重要，别当成两个东西）
 *
 * **它们做的是同一件事** —— `onDestroy` 就是当前 Owner 上的清理注册。
 * `onDispose` 来自 `@vobs/reactivity`（`@vobs/vobs` 重导出了整个反应式层），
 * 能力一直都在；缺的是这个名字，以及"它该在哪用"的说明。
 *
 * 之所以用 `onDestroy` 作为**面向生命周期**的名字：它与 `onMount` 成对，
 * 而 `onDispose` 更像"Owner 被销毁"的底层原语 —— 两者都能用，行为一致。
 *
 * ## 典型用法（D 条那个 hero 轮播）
 *
 * ```ts
 * let timer: ReturnType<typeof setInterval> | undefined
 * onMount(() => {
 *   timer = setInterval(() => index.value = (index.value + 1) % total, 5000)
 * })
 * onDestroy(() => {
 *   if (timer !== undefined) clearInterval(timer)
 * })
 * ```
 *
 * 注意 `onMount` 里创建的定时器**必须在 `onDestroy` 清掉**：`onMount` 的回调
 * 只在客户端跑（服务端没有 `document`），所以构建进程里不会留下定时器；
 * 但客户端卸载时不清就会泄漏。
 *
 * ## 语义
 *
 * - 在**当前 Owner** 上注册；组件卸载 / `app.destroy()` / 作用域释放时执行
 * - 与 `onDispose` 一样：清理**逆序**执行，且**单个清理抛错不会中断其余清理**
 *   （`owner.ts` 做了逐个隔离）
 * - 不在任何 Owner 下调用**抛出**（不静默丢弃 —— 那会让"清理没跑"变成最难查的泄漏）
 */
export function onDestroy(callback: () => void): void {
  if (typeof callback !== 'function') {
    throw new Error('Vobs: onDestroy 需要一个函数')
  }
  if (!getCurrentOwner()) {
    throw new Error(
      'Vobs onDestroy: 当前不在任何组件/作用域内，清理不会被执行。'
      + '请在组件体内或 effect/owner.run 里调用。'
    )
  }
  onDispose(callback)
}

/**
 * 组件/作用域**挂载之后**跑一次。
 *
 * 为什么需要它（外部踩坑文档 D 条 + 能力覆盖度分析）：
 * 定时器、`matchMedia`、`localStorage`、量元素尺寸这些只能在客户端做的事，
 * 此前**没有一个正式位置** —— 业务只能手写 `typeof window !== 'undefined'`，
 * 或者在组件体里直接调用（于是 SSG/预渲染阶段就炸或泄漏）。这是文档里
 * 「生命周期零记录」那条能力缺口的实体。
 *
 * 语义（与 run-once 一致，别按 React 的 `useEffect` 直觉理解）：
 *
 * - 回调在**当前挂载同步过程结束之后**跑一次（用微任务），此时 DOM 已在文档中，
 *   所以可以量尺寸、focus、读 `matchMedia`
 * - 组件**在此之前就被卸载**时回调不会跑（检查 Owner）
 * - 不在任何 Owner 下调用时**立刻执行**（例如模块顶层或普通函数里）——
 *   不静默丢弃，因为"没跑"是最难查的那种失败
 * - 没有 `document`（Node 端 SSR）时**不执行**：预渲染阶段没有浏览器 API 可用
 *
 * ⚠️ 如实说明边界：SSR 判定用的是「有没有 `document`」。若在 **jsdom 这类带 DOM 的环境里**
 * 做预渲染，回调仍会执行 —— 那种环境下"是不是预渲染"从运行时无法可靠区分。
 * 需要严格客户端守卫的场景，请在回调内部再判一次，或用 `@vobs/ssr` 的客户端分支。
 *
 * 返回一个撤销函数：在回调执行前调用它，回调不会跑。
 */
export function onMount(callback: () => void): () => void {
  if (typeof callback !== 'function') {
    throw new Error('Vobs: onMount 需要一个函数')
  }
  const owner: Owner | null = getCurrentOwner()

  // 没有 Owner（模块顶层 / 普通函数）：立刻执行，不静默丢弃
  if (!owner) {
    runIfClient(callback)
    return () => { /* 已经跑过，无需撤销 */ }
  }

  let cancelled = false
  queueMicrotask(() => {
    if (cancelled) return
    // 组件在这之前被卸载 → 不执行（文档 D 条里"泄漏"的那一半）
    if (owner.disposed) return
    runIfClient(callback)
  })

  return () => { cancelled = true }
}

function runIfClient(callback: () => void): void {
  /*
   * 没有 document 就是 Node 端（预渲染）—— 此时浏览器 API 不可用，
   * 执行回调只会抛错或泄漏定时器。跳过是这里的正确行为。
   */
  if (typeof document === 'undefined') return
  callback()
}
