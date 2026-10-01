import { getCurrentOwner } from './owner'
import { getSignalDebugName, invokeDebug, hasDebugHooks, setSignalDebugName } from './debug'

export interface Dependency {
  unsubscribe(subscriber: Subscriber): void
}

export interface Subscriber {
  readonly dependencies: Set<Dependency>
  readonly disposed: boolean
  notify(): void
}

/** 只读信号：派生值（memo）与只读上下文的最小契约，只能订阅与读取。 */
export interface ReadableSignal<T> extends Dependency {
  readonly value: T
  dispose(): void
}

/** 可写信号：state() 的返回类型。`set` 与 `.value =` 赋值语义完全一致。 */
export interface Signal<T> extends ReadableSignal<T> {
  value: T
  set(next: T): void
}

let currentSubscriber: Subscriber | null = null

export function getCurrentSubscriber(): Subscriber | null {
  return currentSubscriber
}

export function setCurrentSubscriber(subscriber: Subscriber | null): void {
  currentSubscriber = subscriber
}

/** 在 `fn` 执行期间暂停依赖追踪，结束后恢复（嵌套安全）。 */
export function untrack<T>(fn: () => T): T {
  const previous = currentSubscriber
  currentSubscriber = null
  try {
    return fn()
  } finally {
    currentSubscriber = previous
  }
}

export function trackDependency(dependency: Dependency): void {
  if (!currentSubscriber || currentSubscriber.disposed) return
  const added = !currentSubscriber.dependencies.has(dependency)
  currentSubscriber.dependencies.add(dependency)
  if (added && hasDebugHooks()) invokeDebug('dependencyTracked', dependency, currentSubscriber)
}

/**
 * 一个 state 信号。
 *
 * **这里为什么是 class 而不是对象字面量**（实测，同机同轮循环，每次 `.value` 读写）：
 *
 *   对象字面量里的 get/set 访问器      83.6 ns
 *   同样两个访问器放在 class 原型上      1.2 ns   ← 70×
 *   class 原型 + 判等 + 分支           3.2 ns   ← 对比字面量版的 81 ns
 *
 * 原因：**在对象字面量里定义访问器会让 V8 把这个实例降级成字典模式**，之后每次属性
 * 访问都走慢路径。放到原型上就不影响实例的隐藏类。
 *
 * 这是整个框架最热的路径（每次读、每次写都经过它），也是 Owner 那边同一个病
 * （`owner.ts` 的 `get disposed()`）。
 */
class StateSignal<T> implements Signal<T> {
  private current: T
  private disposed = false
  private warnedAfterDispose = false
  private readonly subscribers = new Set<Subscriber>()
  /**
   * 上一次通知用的订阅者快照。通知时要快照（订阅者可能在自己被通知的过程中退订），
   * 但不必每次写都重建：订阅集合只在 add/delete 时变，任何增删把它置空即可。
   */
  private notifySnapshot: Subscriber[] | null = null
  /**
   * `set` 刻意做成**逐实例的箭头函数**而不是原型方法。
   *
   * 它必须能脱离对象直接当回调传递（`const { set } = signal; onClick = () => set(1)`），
   * 原型方法会丢 `this`。这条契约有测试锁定：
   * 「set 可脱离对象直接作为回调传递」。
   *
   * 代价是每个信号多一个闭包分配 —— 不在读写热路径上，换来的是这条契约不破。
   */
  readonly set: (next: T) => void

  constructor(initialValue: T) {
    this.current = initialValue
    this.set = (next: T) => { this.value = next }
  }

  get value(): T {
    const subscriber = getCurrentSubscriber()
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber)
      this.notifySnapshot = null
      if (hasDebugHooks()) invokeDebug('signalRead', this as unknown as Signal<unknown>, subscriber)
      trackDependency(this)
    }
    return this.current
  }

  set value(nextValue: T) {
    if (this.disposed) {
      // 显式 dispose 后的写入永远是编程错误：每信号限警告一次，避免循环刷屏
      if (!this.warnedAfterDispose) {
        this.warnedAfterDispose = true
        const name = getSignalDebugName(this as unknown as Signal<unknown>)
        console.warn(`[vobs] 写入已 dispose 的 state${name ? ` "${name}"` : ''}，本次写入被忽略`)
      }
      return
    }
    if (Object.is(this.current, nextValue)) return
    const previousValue = this.current
    this.current = nextValue
    if (hasDebugHooks()) invokeDebug('signalChanged', this as unknown as Signal<unknown>, previousValue, nextValue)
    if (this.subscribers.size === 0) return
    // 订阅集合没变就复用上次的快照（增删处会置空）
    const snapshot = this.notifySnapshot ?? (this.notifySnapshot = [...this.subscribers])
    for (const subscriber of snapshot) subscriber.notify()
  }

  unsubscribe(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber)
    this.notifySnapshot = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.subscribers.clear()
    this.notifySnapshot = null
    if (hasDebugHooks()) invokeDebug('signalDisposed', this as unknown as Signal<unknown>)
  }
}

/**
 * Create a reactive state signal.
 *
 * State uses identity (`Object.is`) change detection. Objects and arrays are
 * intentionally shallow: mutating a nested property in place does not notify
 * subscribers; assign a new object/array to `value` to publish the change.
 *
 * Lifetime: a state signal is a plain value — it stays writable for as long
 * as it is reachable and is never disposed automatically. Component-scoped
 * effects that subscribe to it are disposed with their owner (which
 * unsubscribes them), so the subscription graph is still cleaned up; the
 * signal itself survives. This keeps data created inside event handlers
 * (which run under `owner.run`) alive even after the triggering UI scope —
 * e.g. a dropdown menu — is destroyed.
 *
 * The optional debug name is metadata for inspection tools only. It does not
 * affect subscriptions, scheduling, serialization, or the signal contract.
 */
export function state<T>(initialValue: T, debugName?: string): Signal<T> {
  const signalInstance = new StateSignal(initialValue)
  // 信号寿命 = 可达性：不注册 owner 清理（效果销毁时经 unsubscribe 自行解除
  // 订阅，订阅图仍然随作用域释放）。显式 dispose() 仅供调用方手动废弃信号。
  // owner 仅用于调试钩子的归属信息（devtools 索引），不影响生命周期。
  if (hasDebugHooks()) {
    invokeDebug('signalCreated', signalInstance as unknown as Signal<unknown>, getCurrentOwner())
  }
  if (debugName?.trim()) setSignalDebugName(signalInstance as unknown as Signal<unknown>, debugName.trim())
  return signalInstance
}
