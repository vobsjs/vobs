import { invokeDebug, hasDebugHooks } from './debug'

export interface Owner {
  readonly id: string
  readonly parent: Owner | null
  readonly children: readonly Owner[]
  readonly depth: number
  readonly disposed: boolean
  run<T>(fn: () => T): T
  addCleanup(cleanup: () => void): void
  onDispose(cleanup: () => void): void
  onError(handler: (error: unknown) => void): () => void
  handleError(error: unknown): boolean
  dispose(): void
}

let currentOwner: Owner | null = null
let nextOwnerId = 1
const ownerNames = new WeakMap<Owner, string>()

export function createOwner(): Owner {
  const parent = currentOwner
  let disposed = parent?.disposed ?? false
  const children: Owner[] = []
  const cleanups: Array<() => void> = []
  const errorHandlers = new Set<(error: unknown) => void>()

  const owner: Owner = {
    id: `owner-${nextOwnerId++}`,
    parent,
    children,
    depth: (parent?.depth ?? -1) + 1,

    get disposed(): boolean {
      return disposed
    },

    run<T>(fn: () => T): T {
      if (disposed) throw new Error('Vobs: 已销毁的 Owner 不能继续运行')
      const previous = currentOwner
      currentOwner = owner
      try {
        return fn()
      } finally {
        currentOwner = previous
      }
    },

    addCleanup(cleanup: () => void): void {
      if (disposed) {
        cleanup()
        return
      }
      cleanups.push(cleanup)
    },

    onDispose(cleanup: () => void): void {
      owner.addCleanup(cleanup)
    },

    onError(handler: (error: unknown) => void): () => void {
      errorHandlers.add(handler)
      const remove = () => errorHandlers.delete(handler)
      owner.addCleanup(remove)
      return remove
    },

    handleError(error: unknown): boolean {
      for (const handler of [...errorHandlers].reverse()) {
        try {
          handler(error)
          return true
        } catch (handlerError) {
          return parent?.handleError(handlerError) ?? false
        }
      }
      return parent?.handleError(error) ?? false
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      for (const child of [...children]) child.dispose()
      children.length = 0

      let firstError: unknown
      for (let index = cleanups.length - 1; index >= 0; index--) {
        try {
          cleanups[index]()
        } catch (error) {
          firstError ??= error
        }
      }
      cleanups.length = 0

      if (parent) {
        const index = parent.children.indexOf(owner)
        if (index >= 0) (parent.children as Owner[]).splice(index, 1)
      }
      if (hasDebugHooks()) invokeDebug('ownerDisposed', owner)
      if (firstError) throw firstError
    }
  }

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
