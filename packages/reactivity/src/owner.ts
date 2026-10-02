import { invokeDebug, hasDebugHooks } from './debug'

export interface OwnerScopeMark {
  readonly cleanups: number
  readonly children: number
}

export interface Owner {
  readonly id: string
  readonly parent: Owner | null
  readonly children: readonly Owner[]
  readonly depth: number
  readonly disposed: boolean
  run<T>(fn: () => T): T
  addCleanup(cleanup: () => void): void
  onDispose(cleanup: () => void): void
  /**
   * 撤销一个**已注册**的清理函数（按函数身份匹配）。
   *
   * 用途：把"同一个逻辑资源"的清理**替换**掉，而不是每次重建都追加一条。
   * 典型场景是 `ref` —— 同一个 ref 对象被先后绑到不同节点时，
   * 旧那条清理会把新值清成 `null`（见 runtime/src/ref.ts）。
   *
   * 语义：只删第一条身份相同的项；没找到就什么都不做（幂等）。
   * 已 dispose 的 Owner 上是 no-op。
   */
  removeCleanup(cleanup: () => void): void
  onError(handler: (error: unknown) => void): () => void
  handleError(error: unknown): boolean
  dispose(): void
  /** 记录当前清理/子 Owner 注册位置，供 disposeSince 成对使用（渲染作用域）。 */
  mark(): OwnerScopeMark
  /** 释放 mark 之后注册的清理与期间创建的子 Owner，Owner 自身保活。 */
  disposeSince(mark: OwnerScopeMark): void
}

let currentOwner: Owner | null = null
let nextOwnerId = 1
const ownerNames = new WeakMap<Owner, string>()

/**
 * Owner 实现。
 *
 * **这里为什么是 class 而不是对象字面量**（实测数据，同一台机器、同一轮循环）：
 *
 *   createOwner()（原字面量实现）        1314 ns/次
 *   只用数据字段                         155 ns
 *   ＋ 对象字面量里的 `get disposed()`      500 ns
 *   ＋ 3 个逐实例闭包方法                 1095 ns
 *   （对象字面量 11 个方法时就是上面那个 1314）
 *
 * 两个原因：
 * 1. **字面量里的访问器会让 V8 把每个实例降级成字典模式**（属性访问从此走慢路径）。
 *    单是这一项就 +345ns。所以 `disposed` 是**普通数据字段**，不是 getter ——
 *    对外读法 `owner.disposed` 完全不变。
 * 2. **逐实例的闭包方法**每个都要新建一个函数对象（11 个 ≈ +800ns）。
 *    放到原型上就只分配一份。
 *
 * 这一条热路径不常见：`insertDynamicValue` 的原始值快路径**每轮**都要建一个 Owner
 * 再销毁（`dynamic.ts:65`），也就是每次文本更新都付这份钱。
 */
class OwnerImpl implements Owner {
  readonly id: string
  readonly parent: Owner | null
  readonly children: Owner[] = []
  readonly depth: number
  disposed: boolean
  private readonly cleanups: Array<() => void> = []
  private readonly errorHandlers = new Set<(error: unknown) => void>()

  constructor() {
    const parent = currentOwner
    this.parent = parent
    this.depth = (parent?.depth ?? -1) + 1
    this.id = `owner-${nextOwnerId++}`
    this.disposed = parent?.disposed ?? false
  }

  run<T>(fn: () => T): T {
    if (this.disposed) throw new Error('Vobs: 已销毁的 Owner 不能继续运行')
    const previous = currentOwner
    currentOwner = this
    try {
      return fn()
    } finally {
      currentOwner = previous
    }
  }

  addCleanup(cleanup: () => void): void {
    if (this.disposed) {
      cleanup()
      return
    }
    this.cleanups.push(cleanup)
  }

  onDispose(cleanup: () => void): void {
    this.addCleanup(cleanup)
  }

  /**
   * 撤销一条已注册的清理。
   *
   * 用 `splice` 而不是"标记失效"：标记法会让数组继续增长（本包已经因为
   * `Owner.cleanups` 只增不减吃过一次亏 —— runtime 的事件重绑），
   * 而这个 API 的语义就是"替换掉旧的"，就该真的从数组里去掉。
   *
   * 复杂度 O(n)，但调用场景是"同一资源被重新绑定"，不是热路径上的每帧操作。
   */
  removeCleanup(cleanup: () => void): void {
    const index = this.cleanups.indexOf(cleanup)
    if (index >= 0) this.cleanups.splice(index, 1)
  }

  onError(handler: (error: unknown) => void): () => void {
    this.errorHandlers.add(handler)
    const remove = () => this.errorHandlers.delete(handler)
    this.addCleanup(remove)
    return remove
  }

  handleError(error: unknown): boolean {
    for (const handler of [...this.errorHandlers].reverse()) {
      try {
        handler(error)
        return true
      } catch (handlerError) {
        return this.parent?.handleError(handlerError) ?? false
      }
    }
    return this.parent?.handleError(error) ?? false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    let firstError: unknown
    /*
     * 子 Owner 的清理抛错**不能中断级联销毁**。
     *
     * 这里原来是裸调 `child.dispose()`：一个子级 cleanup 抛错就让兄弟 Owner 全不销毁、
     * 父自身的 cleanup 也不跑（实测复现：父 cleanup 未执行、第二个子 owner 仍存活）。
     * 那是资源泄漏 —— effect 不解绑、监听不移除。与下面清理循环同样逐个隔离，
     * 收集首个错误最后重抛。
     */
    for (const child of [...this.children]) {
      try {
        child.dispose()
      } catch (error) {
        firstError ??= error
      }
    }
    this.children.length = 0

    const cleanups = this.cleanups
    for (let index = cleanups.length - 1; index >= 0; index--) {
      try {
        cleanups[index]()
      } catch (error) {
        firstError ??= error
      }
    }
    cleanups.length = 0

    const parent = this.parent
    if (parent) {
      const index = parent.children.indexOf(this)
      if (index >= 0) (parent.children as Owner[]).splice(index, 1)
    }
    if (hasDebugHooks()) invokeDebug('ownerDisposed', this)
    if (firstError) throw firstError
  }

  mark(): OwnerScopeMark {
    return { cleanups: this.cleanups.length, children: this.children.length }
  }

  disposeSince(mark: OwnerScopeMark): void {
    if (this.disposed) return
    // 先释放 mark 之后创建的子 Owner（dispose 会自行从 children 摘除），
    // 再逆序执行 mark 之后注册的清理，顺序语义与 dispose 一致。
    let firstError: unknown
    // 同 dispose：子 Owner 抛错不能打断级联
    for (const child of this.children.slice(mark.children)) {
      try {
        child.dispose()
      } catch (error) {
        firstError ??= error
      }
    }

    const cleanups = this.cleanups
    for (let index = cleanups.length - 1; index >= mark.cleanups; index--) {
      try {
        cleanups[index]()
      } catch (error) {
        firstError ??= error
      }
    }
    cleanups.length = Math.min(cleanups.length, mark.cleanups)
    if (firstError) throw firstError
  }
}

export function createOwner(): Owner {
  const owner = new OwnerImpl()
  const parent = owner.parent
  if (parent && !parent.disposed) (parent.children as Owner[]).push(owner)
  if (hasDebugHooks()) invokeDebug('ownerCreated', owner)
  return owner
}

export function setOwnerDebugName(owner: Owner, name: string): void {
  ownerNames.set(owner, name)
  if (hasDebugHooks()) invokeDebug('ownerNamed', owner, name)
}

export function getOwnerDebugName(owner: Owner): string | undefined {
  return ownerNames.get(owner)
}

export function getCurrentOwner(): Owner | null {
  return currentOwner
}

/** Re-enter an Owner for an explicitly captured asynchronous continuation. */
export function runWithOwner<T>(owner: Owner, fn: () => T): T {
  return owner.run(fn)
}

export function onDispose(cleanup: () => void): void {
  const owner = getCurrentOwner()
  if (!owner) throw new Error('Vobs: onDispose 必须在 Owner 作用域内调用')
  owner.onDispose(cleanup)
}
