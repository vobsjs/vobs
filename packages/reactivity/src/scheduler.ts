import type { Effect } from './effect'
import { invokeDebug } from './debug'

export class Scheduler {
  private readonly dirtyEffects = new Set<Effect>()
  private readonly lowPriorityEffects = new Set<Effect>()
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
    invokeDebug('flushStart')
    let rounds = 0
    let firstError: unknown
    let hasError = false
    try {
      while (this.dirtyEffects.size > 0 || this.lowPriorityEffects.size > 0) {
        if (++rounds > 100) {
          this.dirtyEffects.clear()
          throw new Error('Vobs: 响应式更新超过 100 轮，可能存在循环依赖')
        }

        const effects = [...this.dirtyEffects, ...this.lowPriorityEffects]
          .filter(effect => !effect.disposed)
          .sort((a, b) => {
            const aLow = this.lowPriorityEffects.has(a) ? 1 : 0
            const bLow = this.lowPriorityEffects.has(b) ? 1 : 0
            return aLow - bLow || b.depth - a.depth || a.order - b.order
          })
        this.dirtyEffects.clear()
        this.lowPriorityEffects.clear()
        for (const effect of effects) {
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
      }
    } finally {
      this.flushing = false
      invokeDebug('flushEnd')
    }
    if (hasError) throw firstError
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
