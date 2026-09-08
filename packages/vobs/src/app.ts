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
  version?: string
  requires?: readonly VobsPlugin[]
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
  config: VobsConfig<any, any, any, any>
): VobsApp<any> {
  if (!config.render) throw new Error('createVobs: render 不能为空')

  const renderer = config.renderer ?? createDOMRenderer()
  const rootOwner: Owner = createOwner()
  setOwnerDebugName(rootOwner, 'App')
  const cleanups: Array<() => void> = []
  const errorHandlers = new Set<(error: unknown) => void>()
  const installed = new Set<string>()
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
        throw new Error(`Vobs: 找不到必需注入项${description ? ` ${description}` : ''}`)
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
        // 错误处理器不能覆盖触发它的原始错误。
      }
    }
  }

  function installPlugin(plugin: VobsPlugin): void {
    if (installed.has(plugin.name)) return
    if (installing.has(plugin.name)) {
      throw new Error(`Vobs: 插件依赖存在循环：${plugin.name}`)
    }

    installing.add(plugin.name)
    try {
      for (const dependency of plugin.requires ?? []) installPlugin(dependency)
      const cleanup = plugin.install?.(context)
      if (cleanup) cleanups.push(cleanup)
      installed.add(plugin.name)
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
    return firstError
  }

  function start(target: string | any, hydrating: boolean): void {
    if (destroyed) throw new Error('Vobs: 已销毁的应用不能挂载')
    if (mounted) return

    container = typeof target === 'string' ? document.querySelector(target) : target
    if (!container) throw new Error(`mount: 目标不存在: ${target}`)
    if (hydrating && !renderer.beginHydration) {
      throw new Error('Vobs: 当前渲染器不支持 Hydration')
    }

    setRenderer(renderer)
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
      if (destroyed) throw new Error('Vobs: 已销毁的应用不能安装插件')
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
      if (destroyed) throw new Error('Vobs: 已销毁的应用不能更新')
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
