import type { Effect } from './effect'
import { hasDebugHooks, invokeDebug } from './debug'

export class Scheduler {
  private readonly dirtyEffects = new Set<Effect>()
  private readonly lowPriorityEffects = new Set<Effect>()
  // flush is non-reentrant (guaranteed by the flushing flag); the buffer arrays can be safely reused across rounds, avoiding per-round allocation.
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

  /**
   * Batch: suppress scheduling, flush synchronously on exit.
   *
   * Note: do **not** put the flush inside `finally` — then when `fn()` throws, an
   * error thrown by flush itself would replace the original error (a throw in
   * `finally` overrides the throw in `try`), and the developer sees an error
   * unrelated to their own code. Instead: the original error wins; the flush error
   * is logged but does not replace it.
   */
  batch<T>(fn: () => T): T {
    this.batchDepth++
    let result!: T
    let thrown: unknown
    let failed = false
    try {
      result = fn()
    } catch (error) {
      thrown = error
      failed = true
    } finally {
      this.batchDepth--
    }

    if (this.batchDepth === 0) {
      try {
        this.flush()
      } catch (flushError) {
        if (!failed) throw flushError
        // The error thrown by fn itself wins. The flush error must not be lost either, but it can only be logged as supplementary information.
        console.error('[Vobs] flush inside batch threw an additional error (original error takes priority):', flushError)
      }
    }

    if (failed) throw thrown
    return result
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
          throw new Error('Vobs: reactive updates exceeded 100 rounds; a circular dependency is likely')
        }

        // normal first, then low; the two groups are sorted separately — same
        // semantics as the old merged sort (in the old comparator, low priority
        // already outranked depth), but without the Set lookups inside the comparator.
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

  /** Collects non-disposed effects and clears the source set; effects scheduled during run() are left for the next round. */
  private collectRunnable(source: Set<Effect>, target: Effect[]): void {
    for (const effect of source) {
      if (!effect.disposed) target.push(effect)
    }
    source.clear()
  }
}

/** Deeper effects run first (children before parents); at equal depth, creation order wins. */
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
