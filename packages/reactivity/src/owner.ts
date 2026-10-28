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
   * Remove a **registered** cleanup (matched by function identity).
   *
   * Purpose: **replace** the cleanup of "the same logical resource" instead of
   * appending a new entry on every rebuild. The typical case is `ref` — when the
   * same ref object is bound to different nodes in sequence, the stale entry would
   * reset the new value to `null` on dispose (see runtime/src/ref.ts).
   *
   * Semantics: remove only the first identity-equal entry; a miss is a no-op
   * (idempotent). No-op on a disposed Owner.
   */
  removeCleanup(cleanup: () => void): void
  onError(handler: (error: unknown) => void): () => void
  handleError(error: unknown): boolean
  dispose(): void
  /** Records the current cleanup/child-Owner registration position, to be paired with disposeSince (render scopes). */
  mark(): OwnerScopeMark
  /** Releases cleanups registered after the mark and child Owners created since then; the Owner itself stays alive. */
  disposeSince(mark: OwnerScopeMark): void
}

let currentOwner: Owner | null = null
let nextOwnerId = 1
const ownerNames = new WeakMap<Owner, string>()

/**
 * Owner implementation.
 *
 * **Why a class here instead of an object literal** (measured, same machine, same loop):
 *
 *   createOwner() (original literal impl)     1314 ns/op
 *   data fields only                          155 ns
 *   + `get disposed()` on the literal          500 ns
 *   + 3 per-instance closure methods          1095 ns
 *   (the literal with 11 methods is that 1314 figure)
 *
 * Two reasons:
 * 1. **Accessors on a literal demote every instance to dictionary mode in V8**
 *    (property access takes the slow path from then on). That alone costs +345 ns.
 *    So `disposed` is a **plain data field**, not a getter — the external read
 *    `owner.disposed` is unchanged.
 * 2. **Per-instance closure methods** each allocate a new function object
 *    (11 of them ≈ +800 ns). On the prototype they are allocated once.
 *
 * This is not a rare hot path: `insertDynamicValue`'s primitive fast path creates
 * and destroys an Owner **every round** (`dynamic.ts:65`), i.e. every text update
 * pays this cost.
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
    if (this.disposed) throw new Error('Vobs: cannot run inside a disposed Owner')
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
   * Remove one registered cleanup.
   *
   * `splice` instead of "mark as stale": the marking approach would let the array
   * keep growing (this package has already been burned once by `Owner.cleanups`
   * growing without bound — the runtime's event rebinding), and this API's
   * semantics is "replace the old one", so it should really leave the array.
   *
   * O(n), but the call site is "the same resource gets rebound", not a per-frame
   * hot-path operation.
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
     * A child Owner's cleanup throwing must **not interrupt the cascading dispose**.
     *
     * This used to call `child.dispose()` bare: one child cleanup throwing meant
     * sibling Owners were never disposed and the parent's own cleanups never ran
     * (reproduced: parent cleanup not executed, second child owner still alive).
     * That is a resource leak — effects stay bound, listeners stay attached.
     * Isolated one by one like the cleanup loop below; the first error is
     * collected and re-thrown at the end.
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
    // Dispose child Owners created after the mark first (dispose removes them from
    // children on its own), then run the cleanups registered after the mark in
    // reverse order — same ordering semantics as dispose.
    let firstError: unknown
    // Same as dispose: a child Owner throwing must not break the cascade
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
  if (!owner) throw new Error('Vobs: onDispose must be called inside an Owner scope')
  owner.onDispose(cleanup)
}
