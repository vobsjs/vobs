import { cleanupDependencies } from './effect'
import { getCurrentOwner } from './owner'
import { invokeDebug, hasDebugHooks } from './debug'
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
  trackDependency,
  type Dependency,
  type ReadableSignal,
  type Subscriber
} from './signal'

/** 派生值：只读信号。写入在类型层面即被禁止；运行时保留 setter 防线兜底未经类型检查的调用方。 */
export interface Memo<T> extends ReadableSignal<T> {}

/**
 * memo 的依赖收集身份（在 compute 期间充当 currentSubscriber）。
 *
 * 与 `MemoSignal` 分开是必需的：一个是信号（可被订阅），一个是订阅者（收集依赖），
 * 二者不能是同一个对象。**这里为什么是 class 而不是对象字面量**，见 `MemoSignal` 的说明。
 */
class MemoSubscriber<T> implements Subscriber {
  readonly dependencies = new Set<Dependency>()
  /** 数据字段而不是 `get disposed()`：字面量里的访问器会让实例掉进字典模式。 */
  disposed = false

  constructor(private readonly signal: MemoSignal<T>) {}

  notify(): void {
    // 与原来的闭包实现同一逻辑：已销毁或已脏都不再向下传播
    if (this.disposed || this.signal.dirty) return
    this.signal.invalidate()
  }
}

/**
 * 派生值信号。
 *
 * **class 而不是对象字面量**：与 `signal.ts` 的 `StateSignal` 同一个原因 ——
 * 对象字面量里的 get/set 访问器会让 V8 把实例降级成字典模式，实测每次 `.value`
 * 读从 ~1ns 变成 ~13ns，而 memo 读是渲染热路径的一部分。
 */
class MemoSignal<T> implements Memo<T> {
  /** 派生值缓存与脏标记：由本信号独占（订阅者通过引用访问）。 */
  cached!: T
  dirty = true
  disposed = false
  readonly subscribers = new Set<Subscriber>()
  readonly subscriber: MemoSubscriber<T>
  /**
   * 逐实例箭头函数：对外必须能**脱离对象**传递 ——
   * `owner?.addCleanup(memoSignal.dispose)` 就是这么用的，原型方法会丢 `this`。
   */
  readonly dispose: () => void

  constructor(private readonly compute: () => T) {
    this.subscriber = new MemoSubscriber(this)
    this.dispose = () => { this.disposeNow() }
  }

  get value(): T {
    const subscriber = getCurrentSubscriber()
    if (subscriber && !subscriber.disposed) {
      this.subscribers.add(subscriber)
      trackDependency(this)
    }

    if (this.dirty) {
      const memoSubscriber = this.subscriber
      cleanupDependencies(memoSubscriber)
      const previous = getCurrentSubscriber()
      setCurrentSubscriber(memoSubscriber)
      try {
        this.cached = this.compute()
        this.dirty = false
      } finally {
        setCurrentSubscriber(previous)
      }
    }

    return this.cached
  }

  set value(_: T) {
    throw new Error('memo: 派生值不能直接赋值')
  }

  unsubscribe(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber)
  }

  /** 由 MemoSubscriber 调用：标脏并向下传播失效。 */
  invalidate(): void {
    this.dirty = true
    if (hasDebugHooks()) invokeDebug('memoInvalidated', this as unknown as ReadableSignal<unknown>)
    for (const subscriber of [...this.subscribers]) subscriber.notify()
  }

  private disposeNow(): void {
    if (this.disposed) return
    this.disposed = true
    this.subscriber.disposed = true
    this.subscribers.clear()
    cleanupDependencies(this.subscriber)
    if (hasDebugHooks()) invokeDebug('signalDisposed', this as unknown as ReadableSignal<unknown>)
  }
}

export function memo<T>(compute: () => T): Memo<T> {
  const memoSignal = new MemoSignal(compute)
  const owner = getCurrentOwner()
  owner?.addCleanup(memoSignal.dispose)
  if (hasDebugHooks()) {
    invokeDebug('signalCreated', memoSignal as unknown as ReadableSignal<unknown>, owner)
    invokeDebug('memoCreated', memoSignal as unknown as ReadableSignal<unknown>, memoSignal.subscriber, owner)
  }
  return memoSignal
}
