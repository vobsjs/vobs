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
   * 元信息。**不参与任何判断** —— 唯一被用到的地方是「同名插件被跳过」时把它印进诊断，
   * 让人看得出被跳过的是哪个版本。别指望它做兼容性检查。
   */
  version?: string
  /** 依赖：安装本插件前会先自动安装它们（按名字去重，检测循环）。 */
  requires?: readonly VobsPlugin[]
  /**
   * **仅声明**：框架不会自动安装它们，也不做任何校验 —— `requires` 才是"必须且自动安装"。
   * 与 `version` 同属元信息，留给工具/诊断使用（`app.test.ts` 有一条测试锁住
   * 「声明 optional 不会安装它」这个语义）。
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
  // 不带 renderer 时走 DOM 默认渲染器，节点类型就是 DOM 的 Node
  // （原来这里标成 `VobsApp<any>`，于是 app.mount 的参数类型直接塌成 any）
  config: VobsConfig<Node, Text, Element, Comment> & { renderer?: undefined }
): VobsApp<Node>
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
  /** 名字 → 插件对象：用于「同名但不同对象」的诊断（`installed` 只记名字）。 */
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
    const already = installedPlugins.get(plugin.name)
    if (already !== undefined) {
      /*
       * 按**名字**去重：同名插件第二次不会被安装。
       *
       * 但"换个对象却同名"是很容易踩的坑（两个包都叫 router、同名插件被重新创建一次），
       * 结果是第二个**永不安装且毫无提示**。所以这里说一声。
       * 注意不能改成按对象身份去重 —— 那会让「同一个插件 use 两次」重复安装，破坏现有语义。
       */
      if (already !== plugin) {
        const before = already.version ? `（版本 ${already.version}）` : ''
        const now = plugin.version ? `（版本 ${plugin.version}）` : ''
        console.warn(`[vobs] 插件 "${plugin.name}" 已安装${before}，本次传入的是另一个对象${now}，已跳过。`
          + ' 同名插件只会安装一次 —— 若这是两个不同的插件，请给它们不同的 name。')
      }
      return
    }
    if (installing.has(plugin.name)) {
      throw new Error(`Vobs: 插件依赖存在循环：${plugin.name}`)
    }

    installing.add(plugin.name)
    try {
      for (const dependency of plugin.requires ?? []) installPlugin(dependency)
      const cleanup = plugin.install?.(context)
      /*
       * install 的返回值必须是清理函数，或什么都不返回。
       *
       * 原来直接把返回值 push 进 cleanups：`install: async () => …` 返回的 Promise 会被当成
       * 清理函数 —— 安装"成功"、初始化却没做完，直到 **destroy 时才以
       * `TypeError: cleanups[index] is not a function` 爆出来**，那时现场早没了。
       * 现在在安装期就拒绝，错误出现在它该出现的地方。
       */
      if (cleanup !== undefined && cleanup !== null) {
        if (typeof cleanup !== 'function') {
          const isThenable = typeof (cleanup as { then?: unknown }).then === 'function'
          const kind = isThenable ? 'Promise（install 不能是 async）' : typeof cleanup
          throw new Error(`Vobs: 插件 "${plugin.name}" 的 install 必须同步返回清理函数或不返回，收到 ${kind}`)
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
