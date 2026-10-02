import { getCurrentOwner, type Owner } from './owner'
import { invokeDebug, hasDebugHooks } from './debug'
import {
  getCurrentSubscriber,
  setCurrentSubscriber,
  type Dependency,
  type Subscriber
} from './signal'
import { scheduler } from './scheduler'

export interface Effect extends Subscriber {
  readonly order: number
  readonly depth: number
  run(): void
  scheduleLow(): void
  dispose(): void
}

export type EffectCleanup = () => void
export type EffectCallback = () => void | EffectCleanup

let nextEffectOrder = 1

export function cleanupDependencies(subscriber: Subscriber): void {
  for (const dependency of subscriber.dependencies) {
    dependency.unsubscribe(subscriber)
    if (hasDebugHooks()) invokeDebug('dependencyUntracked', dependency, subscriber)
  }
  subscriber.dependencies.clear()
}

/**
 * effect 的实例。
 *
 * **为什么是 class 而不是对象字面量**：与 `signal.ts` 的 `StateSignal`、`owner.ts` 的
 * `OwnerImpl` 同一个原因 —— 在对象字面量里放 `get disposed()` 访问器会让 V8 把这个实例
 * **降级成字典模式**，此后该实例的每次属性访问都走慢路径，而 `disposed` 是
 * `notify()` / `run()` 每次都要读的字段（每次信号写入 × 每个订阅者读一次）。
 *
 * 实测（`.artifacts/verify-harness/bench-effect-shape.ts`，同机同轮）：
 *   对象字面量 + `get disposed()`   1.665 ms / 20 万次读
 *   class 原型字段                  0.147 ms / 20 万次读   → **11.3×**
 * 这是本包**第三次**修同一个病（signal、owner 已修），effect 是最后漏掉的那个。
 *
 * `disposed` 是普通数据字段而不是访问器 —— 对外读法 `effect.disposed` 完全不变，
 * 包内也从未有人给它赋值（只用 `dispose()` 走状态转移）。
 */
class EffectImpl implements Effect {
  readonly order: number
  readonly depth: number
  readonly dependencies = new Set<Dependency>()
  disposed = false
  /** 上一次 callback 返回的清理函数（下次运行前、或销毁时执行一次）。 */
  private cleanup: EffectCleanup | undefined
  private dirty = true
  /**
   * 逐实例箭头函数：`owner?.addCleanup(eff.dispose)` 需要它能**脱离对象**传递，
   * 原型方法会丢 `this`。这条契约与 `StateSignal.set`、`MemoSignal.dispose` 相同。
   */
  readonly dispose: () => void

  constructor(
    private readonly owner: Owner | null,
    private readonly callback: EffectCallback
  ) {
    this.order = nextEffectOrder++
    this.depth = owner?.depth ?? 0
    this.dispose = () => { this.disposeNow() }
  }

  notify(): void {
    if (this.disposed || this.dirty) return
    this.dirty = true
    if (hasDebugHooks()) invokeDebug('effectInvalidated', this)
    scheduler.schedule(this)
  }

  run(): void {
    if (this.disposed || !this.dirty) return
    this.dirty = false
    const previousCleanup = this.cleanup
    this.cleanup = undefined
    let cleanupError: unknown
    if (previousCleanup) {
      try {
        previousCleanup()
      } catch (error) {
        const handled = this.owner?.handleError(error) ?? false
        if (!handled) cleanupError = error
      }
    }
    cleanupDependencies(this)

    const previous = getCurrentSubscriber()
    setCurrentSubscriber(this)
    let thrown: unknown
    let handled = false
    if (hasDebugHooks()) invokeDebug('effectRunStart', this)
    try {
      const result = this.owner ? this.owner.run(this.callback) : this.callback()
      this.cleanup = typeof result === 'function' ? result : undefined
    } catch (error) {
      thrown = error
      handled = this.owner?.handleError(error) ?? false
      if (!handled) throw error
    } finally {
      setCurrentSubscriber(previous)
      if (hasDebugHooks()) invokeDebug('effectRunEnd', this, thrown, handled)
    }
    if (cleanupError && !thrown) throw cleanupError
  }

  scheduleLow(): void {
    if (this.disposed || this.dirty) return
    this.dirty = true
    scheduler.scheduleLow(this)
  }

  private disposeNow(): void {
    if (this.disposed) return
    this.disposed = true
    this.dirty = false
    scheduler.remove(this)
    const previousCleanup = this.cleanup
    this.cleanup = undefined
    let cleanupError: unknown
    if (previousCleanup) {
      try {
        previousCleanup()
      } catch (error) {
        const handled = this.owner?.handleError(error) ?? false
        if (!handled) cleanupError = error
      }
    }
    cleanupDependencies(this)
    if (hasDebugHooks()) invokeDebug('effectDisposed', this)
    if (cleanupError) throw cleanupError
  }
}

export function effect(callback: EffectCallback): Effect {
  const owner = getCurrentOwner()
  const eff = new EffectImpl(owner, callback)
  owner?.addCleanup(eff.dispose)
  if (hasDebugHooks()) invokeDebug('effectCreated', eff, owner)
  eff.run()
  return eff
}

export const renderEffect = effect
