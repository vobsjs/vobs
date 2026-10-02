import { getCurrentOwner, type Owner } from '@vobs/reactivity'
import { formatVobsError } from './error'

/** A mutable reference populated when a host node is mounted. */
export interface Ref<T extends object = Node> {
  current: T | null
}

export type RefTarget<T extends object = Node> = Ref<T> | ((value: T | null) => void)

export function ref<T extends object = Node>(initialValue: T | null = null): Ref<T> {
  return { current: initialValue }
}

/*
 * 每个 (Owner, ref 目标) 只保留**一条**清理注册。
 *
 * 为什么需要：`ref` 会被先后绑到不同节点（同一个 ref 对象、节点被替换；
 * 或条件分支里换了宿主元素）。若每次都 `onDispose` 追加一条，销毁时按注册**逆序**执行，
 * 后注册的那条先把 `target.current` 清成 `null`，于是先注册那条的守卫
 * （`isObjectRef(target) && target.current !== node`）**恰好通过**，再清一次 ——
 * 最终读到 `null` 而不是当前节点。
 *
 * 用 WeakMap<Owner, WeakMap<target, cleanup>> 而不是往 Owner 上挂属性：
 * Owner 是 class 实例，挂新属性会把它推进字典模式（reactivity/src/owner.ts 记过这笔代价）。
 * target 可弱引用（对象），函数型 ref 也可弱引用，所以不阻止回收。
 */
const refCleanups = new WeakMap<Owner, WeakMap<object, () => void>>()

function rememberRefCleanup(owner: Owner, target: object, cleanup: () => void): void {
  let byTarget = refCleanups.get(owner)
  if (!byTarget) {
    byTarget = new WeakMap()
    refCleanups.set(owner, byTarget)
  }
  const previous = byTarget.get(target)
  if (previous) owner.removeCleanup(previous)
  byTarget.set(target, cleanup)
}

/** Bind a host node to an object or callback ref and clear it with its Owner. */
export function setRef<T extends object>(node: T, target: unknown): void {
  if (!isRefTarget<T>(target)) return
  // SSR's serializable nodes are never exposed as live refs. Custom renderers
  // may use arbitrary host objects, so only exclude the known SSR shape.
  if (isSSRNode(node)) return
  const owner = getCurrentOwner()
  assignRef(target, node)
  if (!owner) return
  const cleanup = (): void => {
    /*
     * 清除 ref 时**必须自己吞掉异常**，不能让 user 的 ref 回调把 dispose 级联打断。
     *
     * `assignRef` 内部已经 try/catch + `console.error`（回调是用户代码，不该让挂载失败），
     * 但那条保护只覆盖"赋值"这一步 —— 而这里还有一个**可能抛错的前置判断**。
     * 按 React 语义，函数型 ref 在卸载时**本来就该收到 `null`**；若回调没判空
     * （如 `node => insertList(node, …)`），它会抛，而异常从 onDispose 冒出去会
     * **中断 Owner 的整个清理循环**（实测：/runtime 页面的 `<ul ref={attachList}>`）。
     * 这与 owner.ts 已修的"子 Owner 抛错不能中断级联"是同一类缺陷。
     */
    try {
      // Do not clear a ref that has since been reassigned to another node.
      if (isObjectRef(target) && target.current !== node) return
      assignRef(target, null)
    } catch (error) {
      console.error(formatVobsError(error, { includeStack: true }))
    }
  }
  rememberRefCleanup(owner, target as object, cleanup)
  owner.onDispose(cleanup)
}

function isSSRNode(value: object): boolean {
  const type = (value as { type?: unknown }).type
  return (type === 'element' || type === 'text' || type === 'comment')
    && !('nodeType' in value)
}

function isObjectRef<T extends object>(value: unknown): value is Ref<T> {
  return Boolean(value && typeof value === 'object' && 'current' in value)
}

function isRefTarget<T extends object>(value: unknown): value is RefTarget<T> {
  return isObjectRef<T>(value) || typeof value === 'function'
}

function assignRef<T extends object>(target: RefTarget<T>, value: T | null): void {
  try {
    if (typeof target === 'function') target(value)
    else target.current = value
  } catch (error) {
    /*
     * ref 回调是用户代码，挂载不该因为它失败 —— 但也不能**完全无声**：
     * 回调抛错时 ref 拿不到节点，界面看起来正常，用户完全不知道为什么。
     * 保持吞掉（不冒泡），但打一条控制台记录。
     */
    console.error(formatVobsError(error, { includeStack: true }))
  }
}
