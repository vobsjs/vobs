import type { Effect } from './effect'
import { hasDebugHooks, invokeDebug } from './debug'

export class Scheduler {
  private readonly dirtyEffects = new Set<Effect>()
  private readonly lowPriorityEffects = new Set<Effect>()
  // flush 不可重入（flushing 标志保证），缓冲数组可在轮次间安全复用，避免每轮分配。
  private readonly normalBuffer: Effect[] = []
  private readonly lowBuffer: Effect[] = []
  private flushing = false
  private scheduled = false
  private batchDepth = 0

  schedule(effect: Effect): void {
    if (effect.disposed) return
    this.dirtyEffects.add(effect)
    this.lowPriorityEffects.delete(effect)
    this.ensureScheduled()
  }

  /** Queue an effect behind normal updates while preserving deterministic order. */
  scheduleLow(effect: Effect): void {
    if (effect.disposed) return
    if (!this.dirtyEffects.has(effect)) this.lowPriorityEffects.add(effect)
    this.ensureScheduled()
  }

  private ensureScheduled(): void {
    if (this.batchDepth === 0 && !this.flushing && !this.scheduled) {
      this.scheduled = true
      queueMicrotask(() => {
        this.scheduled = false
        this.flush()
      })
    }
  }

  remove(effect: Effect): void {
    this.dirtyEffects.delete(effect)
    this.lowPriorityEffects.delete(effect)
  }

  batch<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) this.flush()
    }
  }

  flush(): void {
    if (this.flushing || this.batchDepth > 0) return
    this.flushing = true
    const debugEnabled = hasDebugHooks()
    if (debugEnabled) invokeDebug('flushStart')
    let rounds = 0
    let firstError: unknown
    let hasError = false
    try {
      while (this.dirtyEffects.size > 0 || this.lowPriorityEffects.size > 0) {
        if (++rounds > 100) {
          this.dirtyEffects.clear()
          this.lowPriorityEffects.clear()
          throw new Error('Vobs: 响应式更新超过 100 轮，可能存在循环依赖')
        }

        // normal 先、low 后，两组分别排序：与旧的合并排序语义一致
        // （旧比较器里 low 优先级本就高于 depth），但消除了比较器内的 Set 查找。
        this.collectRunnable(this.dirtyEffects, this.normalBuffer)
        this.collectRunnable(this.lowPriorityEffects, this.lowBuffer)
        sortEffects(this.normalBuffer)
        sortEffects(this.lowBuffer)
        for (const effect of this.normalBuffer) {
          try {
            effect.run()
          } catch (error) {
            // Isolate one failed effect from the rest of the flush. Re-throw
            // the first error after all runnable effects have had a chance.
            if (!hasError) {
              firstError = error
              hasError = true
            }
          }
        }
        for (const effect of this.lowBuffer) {
          try {
            effect.run()
          } catch (error) {
            if (!hasError) {
              firstError = error
              hasError = true
            }
          }
        }
        this.normalBuffer.length = 0
        this.lowBuffer.length = 0
      }
    } finally {
      this.normalBuffer.length = 0
      this.lowBuffer.length = 0
      this.flushing = false
      if (debugEnabled) invokeDebug('flushEnd')
    }
    if (hasError) throw firstError
  }

  /** 收集未 disposed 的 effect 并清空源集合；run() 期间新调度的 effect 留给下一轮。 */
  private collectRunnable(source: Set<Effect>, target: Effect[]): void {
    for (const effect of source) {
      if (!effect.disposed) target.push(effect)
    }
    source.clear()
  }
}

/** depth 深的先跑（子 effect 先于父），同深度按创建顺序。 */
function sortEffects(effects: Effect[]): void {
  if (effects.length > 1) {
    effects.sort((a, b) => b.depth - a.depth || a.order - b.order)
  }
}

export const scheduler = new Scheduler()

export function batch<T>(fn: () => T): T {
  return scheduler.batch(fn)
}

/** Schedule a low-priority effect explicitly. */
export function scheduleLow(effect: Effect): void {
  effect.scheduleLow()
}
