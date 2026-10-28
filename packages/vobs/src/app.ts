import { createOwner, scheduler, setOwnerDebugName, type Owner } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { insertBefore as insertRuntimeNode, setRenderer, type VobsFragment, type VobsRenderer } from '@vobs/runtime'
import { injectFromOwner, provideToOwner } from './context'

export type InjectionKey<T> = symbol & {
  readonly __vobsType?: T
}

export interface ProvideOptions {
  override?: boolean
}

export interface VobsPlugin {
  name: string
  /**
   * Metadata. **Not used in any decision** — the only place it is consumed is the
   * "same-name plugin skipped" diagnostic, to show which version got skipped.
   * Don't expect it to do compatibility checks.
   */
  version?: string
  /** Dependencies: installed automatically before this plugin (deduplicated by name, cycles detected). */
  requires?: readonly VobsPlugin[]
  /**
   * **Declaration only**: the framework neither installs them automatically nor validates —
   * `requires` is the "required and auto-installed" variant. Like `version`, this is
   * metadata for tools/diagnostics (`app.test.ts` has a test locking the
   * "declared optional is not installed" semantics).
   */
  optional?: readonly VobsPlugin[]
  install?: (ctx: VobsContext) => void | (() => void)
}

export interface VobsContext {
  readonly app: VobsApp
  provide<T>(key: InjectionKey<T>, value: T, options?: ProvideOptions): void
  inject<T>(key: InjectionKey<T>): T | undefined
  injectRequired<T>(key: InjectionKey<T>, description?: string): T
  onDestroy(cleanup: () => void): void
  onError(handler: (error: unknown) => void): () => void
}

export interface VobsConfig<
  NodeType = Node,
  TextNode extends NodeType = NodeType,
  ElementNode extends NodeType = NodeType,
  CommentNode extends NodeType = NodeType
> {
  render: () => NodeType | VobsFragment | Node | null | undefined
  renderer?: VobsRenderer<NodeType, TextNode, ElementNode, CommentNode>
  plugins?: VobsPlugin[]
  /** Optional application-level error observer. Observers are isolated from the app. */
  onError?: (error: unknown) => void
}

export interface VobsApp<NodeType = Node> {
  readonly mounted: boolean
  readonly destroyed: boolean
  use(plugin: VobsPlugin): VobsApp<NodeType>
  mount(target: string | NodeType): void
  hydrate(target: string | NodeType): void
  update(): void
  destroy(): void
}

export function createInjectionKey<T>(description: string): InjectionKey<T> {
  return Symbol(description) as InjectionKey<T>
}

export function createVobs(
  config: VobsConfig<Node, Text, Element, Comment>
): VobsApp<Node>
export function createVobs<
  NodeType = Node,
  TextNode extends NodeType = NodeType,
  ElementNode extends NodeType = NodeType,
  CommentNode extends NodeType = NodeType
>(
  config: VobsConfig<NodeType, TextNode, ElementNode, CommentNode> & {
    renderer: VobsRenderer<NodeType, TextNode, ElementNode, CommentNode>
  }
): VobsApp<NodeType>
export function createVobs(
  // Without a renderer, the default DOM renderer is used and the node type is DOM's Node
  // (this used to be annotated `VobsApp<any>`, which collapsed app.mount's parameter type to any)
  config: VobsConfig<Node, Text, Element, Comment> & { renderer?: undefined }
): VobsApp<Node>
export function createVobs(
  config: VobsConfig<any, any, any, any>
): VobsApp<any> {
  if (!config.render) throw new Error('createVobs: render cannot be empty')

  const renderer = config.renderer ?? createDOMRenderer()
  const rootOwner: Owner = createOwner()
  /*
   * `setRenderer` is a **process-level singleton** (runtime/src/ops.ts): the app
   * installs its own renderer on mount, and on destroy it **must restore the one
   * installed before mount**. It used to install without restoring, so:
   * - after a single `renderToString` (which mounts then destroys internally), the
   *   global renderer stayed stuck on the SSR renderer permanently — any later
   *   `createElement` in the same process returned plain data objects (no tagName),
   *   and property operations on real DOM nodes threw;
   * - after a failed hydration it stayed on the "claiming DOM" one (hydration.ts only
   *   resets hydrating to false on the success path), cascading errors.
   */
  let previousRenderer: typeof renderer | undefined
  let rendererInstalled = false

  function installRenderer(): void {
    if (rendererInstalled) return
    previousRenderer = setRenderer(renderer)
    rendererInstalled = true
  }

  function restoreRenderer(): void {
    if (!rendererInstalled) return
    rendererInstalled = false
    const previous = previousRenderer
    previousRenderer = undefined
    setRenderer(previous)
  }
  setOwnerDebugName(rootOwner, 'App')
  const cleanups: Array<() => void> = []
  const errorHandlers = new Set<(error: unknown) => void>()
  const installed = new Set<string>()
  /** name → plugin object: powers the "same name, different object" diagnostic (`installed` only records names). */
  const installedPlugins = new Map<string, VobsPlugin>()
  const installing = new Set<string>()
  let mounted = false
  let destroyed = false
  let container: any = null
  let app!: VobsApp<any>

  if (config.onError) {
    errorHandlers.add(config.onError)
    cleanups.push(() => errorHandlers.delete(config.onError!))
  }

  const context: VobsContext = {
    get app(): VobsApp<any> {
      return app
    },

    provide<T>(key: InjectionKey<T>, value: T, options: ProvideOptions = {}): void {
      provideToOwner(rootOwner, key, value, options)
    },

    inject<T>(key: InjectionKey<T>): T | undefined {
      return injectFromOwner(rootOwner, key)
    },

    injectRequired<T>(key: InjectionKey<T>, description?: string): T {
      const value = injectFromOwner(rootOwner, key)
      if (value === undefined) {
        throw new Error(`Vobs: required injection not found${description ? ` ${description}` : ''}`)
      }
      return value
    },

    onDestroy(cleanup: () => void): void {
      cleanups.push(cleanup)
    },

    onError(handler: (error: unknown) => void): () => void {
      errorHandlers.add(handler)
      const remove = () => errorHandlers.delete(handler)
      cleanups.push(remove)
      return remove
    }
  }

  function notifyError(error: unknown): void {
    for (const handler of [...errorHandlers]) {
      try {
        handler(error)
      } catch {
        // An error handler must not override the original error that triggered it.
      }
    }
  }

  function installPlugin(plugin: VobsPlugin): void {
    const already = installedPlugins.get(plugin.name)
    if (already !== undefined) {
      /*
       * Deduplicate by **name**: a second plugin with the same name is not installed.
       *
       * But "a different object with the same name" is an easy trap to hit (two packages
       * both named router, a same-name plugin re-created once), and the second one
       * **never installs and says nothing**. So we say something.
       * Note this must not switch to deduplicating by object identity — that would
       * install the same plugin twice on `use`, breaking existing semantics.
       */
      if (already !== plugin) {
        const before = already.version ? ` (version ${already.version})` : ''
        const now = plugin.version ? ` (version ${plugin.version})` : ''
        console.warn(`[vobs] Plugin "${plugin.name}" was already installed${before}; this call passed a different object${now} and was skipped.`
          + ' A same-name plugin is only installed once — if these are two different plugins, give them different names.')
      }
      return
    }
    if (installing.has(plugin.name)) {
      throw new Error(`Vobs: plugin dependency cycle: ${plugin.name}`)
    }

    installing.add(plugin.name)
    try {
      for (const dependency of plugin.requires ?? []) installPlugin(dependency)
      const cleanup = plugin.install?.(context)
      /*
       * install's return value must be a cleanup function, or nothing at all.
       *
       * The return value used to be pushed straight into cleanups: a Promise returned by
       * `install: async () => …` would be treated as a cleanup function — installation
       * "succeeded" while initialization never finished, and it only exploded **at
       * destroy time with `TypeError: cleanups[index] is not a function`**, long after
       * the scene was gone. Now it is rejected at install time, where the error belongs.
       */
      if (cleanup !== undefined && cleanup !== null) {
        if (typeof cleanup !== 'function') {
          const isThenable = typeof (cleanup as { then?: unknown }).then === 'function'
          const kind = isThenable ? 'Promise (install cannot be async)' : typeof cleanup
          throw new Error(`Vobs: install of plugin "${plugin.name}" must synchronously return a cleanup function or return nothing; received ${kind}`)
        }
        cleanups.push(cleanup)
      }
      installed.add(plugin.name)
      installedPlugins.set(plugin.name, plugin)
    } finally {
      installing.delete(plugin.name)
    }
  }

  function cleanup(clearContainer = true): unknown {
    let firstError: unknown
    for (let index = cleanups.length - 1; index >= 0; index--) {
      try {
        cleanups[index]()
      } catch (error) {
        firstError ??= error
      }
    }
    cleanups.length = 0

    try {
      rootOwner.dispose()
    } catch (error) {
      firstError ??= error
    }

    if (container && clearContainer) {
      try {
        renderer.clear(container)
      } catch (error) {
        firstError ??= error
      }
    }

    // Both failed mounts and destroy go through here: the global renderer must return to
    // the one installed before this app mounted.
    restoreRenderer()
    return firstError
  }

  function start(target: string | any, hydrating: boolean): void {
    if (destroyed) throw new Error('Vobs: a destroyed app cannot be mounted')
    if (mounted) return

    container = typeof target === 'string' ? document.querySelector(target) : target
    if (!container) throw new Error(`mount: target not found: ${target}`)
    if (hydrating && !renderer.beginHydration) {
      throw new Error('Vobs: the current renderer does not support hydration')
    }

    installRenderer()
    try {
      if (hydrating) renderer.beginHydration?.()
      const rootNode = rootOwner.run(config.render)
      if (!hydrating) renderer.clear(container)
      if (rootNode) insertRuntimeNode(container, rootNode as any, null)
      if (hydrating) renderer.completeHydration?.()
      mounted = true
    } catch (error) {
      notifyError(error)
      const cleanupError = cleanup(!hydrating)
      destroyed = true
      throw cleanupError ?? error
    }
  }

  app = {
    get mounted(): boolean {
      return mounted
    },

    get destroyed(): boolean {
      return destroyed
    },

    use(plugin: VobsPlugin): VobsApp<any> {
      if (destroyed) throw new Error('Vobs: a destroyed app cannot install plugins')
      installPlugin(plugin)
      return app
    },

    mount(target: string | any): void {
      start(target, false)
    },

    hydrate(target: string | any): void {
      start(target, true)
    },

    update(): void {
      if (destroyed) throw new Error('Vobs: a destroyed app cannot update')
      try {
        scheduler.flush()
      } catch (error) {
        notifyError(error)
        throw error
      }
    },

    destroy(): void {
      if (destroyed) return
      try {
        const cleanupError = cleanup()
        if (cleanupError) {
          notifyError(cleanupError)
          throw cleanupError
        }
      } finally {
        mounted = false
        destroyed = true
      }
    }
  }

  try {
    for (const plugin of config.plugins ?? []) app.use(plugin)
  } catch (error) {
    notifyError(error)
    cleanup()
    destroyed = true
    throw error
  }

  return app
}
