import { getCurrentOwner } from '@vobs/reactivity'
import { formatVobsError } from './error'

/** A mutable reference populated when a host node is mounted. */
export interface Ref<T extends object = Node> {
  current: T | null
}

export type RefTarget<T extends object = Node> = Ref<T> | ((value: T | null) => void)

export function ref<T extends object = Node>(initialValue: T | null = null): Ref<T> {
  return { current: initialValue }
}

/** Bind a host node to an object or callback ref and clear it with its Owner. */
export function setRef<T extends object>(node: T, target: unknown): void {
  if (!isRefTarget<T>(target)) return
  // SSR's serializable nodes are never exposed as live refs. Custom renderers
  // may use arbitrary host objects, so only exclude the known SSR shape.
  if (isSSRNode(node)) return
  const owner = getCurrentOwner()
  assignRef(target, node)
  owner?.onDispose(() => {
    /*
     * 清除 ref 时**必须自己吞掉异常**，不能让 user 的 ref 回调把 dispose 级联打断。
     *
     * `assignRef` 内部已经 try/catch + `console.error`（回调是用户代码，不该让挂载失败），
     * 但那条保护只覆盖"赋值"这一步 —— 而这里还有一个**可能抛错的前置判断**：
     * `target.current !== node` 对**函数型 ref**（回调 ref）不适用，走到 `assignRef(target, null)`
     * 时用户的回调会收到 `null`。按 React 语义这正是它该收到 null 的时刻，
     * 但如果回调没判空（如 `node => insertList(node, …)`），它会抛。
     *
     * 实测（端到端交互冒烟）：playground 的 `<ul ref={attachList}>` 就是这种形状，
     * 页面在 dispose 时抛 `Cannot read properties of null (reading 'insertBefore')`，
     * 而**因为异常从 onDispose 里冒出去，Owner.dispose 的清理循环被中断** ——
     * 即"一个坏 ref 回调"会让同一 owner 后续所有 cleanup（effect 解绑、监听移除）
     * 全部不执行。这与 owner.ts:114-128 已经修过的"子 Owner 抛错不能中断级联"是同一类缺陷。
     */
    try {
      // Do not clear a ref that has since been reassigned to another node.
      if (isObjectRef(target) && target.current !== node) return
      assignRef(target, null)
    } catch (error) {
      console.error(formatVobsError(error, { includeStack: true }))
    }
  })
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
