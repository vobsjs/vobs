import type { VobsNode } from './fragment'

export type HmrComponent<Props extends object = Record<string, unknown>> =
  (props: Props) => VobsNode

export interface HmrStateStore {
  get<T>(key: string, initial: T | (() => T)): T
  set<T>(key: string, value: T): void
  has(key: string): boolean
  delete(key: string): void
  clear(): void
}

export interface HmrInstance {
  node: VobsNode
  parent: Node | null
  refresh(): void
}

interface HmrModuleState {
  readonly components: Map<string, HmrComponent>
  readonly state: Map<string, unknown>
  readonly instances: Set<HmrInstance>
}

interface HmrGlobal {
  modules: Map<string, HmrModuleState>
  /** 编译器生成的 hmrStateRef 注册表：键为 `${moduleId}#${声明名}`，值跨模块重执行保活。 */
  states: Map<string, unknown>
}

const globalTarget = globalThis as typeof globalThis & { __VOBS_HMR__?: HmrGlobal }
const hmrGlobal = globalTarget.__VOBS_HMR__ ?? { modules: new Map<string, HmrModuleState>(), states: new Map<string, unknown>() }
globalTarget.__VOBS_HMR__ = hmrGlobal

export function resolveComponent<Props extends object>(
  component: HmrComponent<Props>,
  moduleId: string,
  exportName: string
): HmrComponent<Props> {
  const module = getModule(moduleId)
  const existing = module.components.get(exportName)
  if (existing) return existing as HmrComponent<Props>

  const proxy = ((props: Props) => {
    const current = (proxy as HmrComponent<Props> & { current: HmrComponent<Props> }).current
    return current(props)
  }) as HmrComponent<Props> & { current: HmrComponent<Props> }
  proxy.current = component
  Object.defineProperties(proxy, {
    displayName: { configurable: true, value: component.name || exportName },
    hmrKey: { configurable: false, value: `${moduleId}:${exportName}` }
  })
  module.components.set(exportName, proxy as HmrComponent)
  return proxy
}

export function updateHmrModule(_moduleId: string, nextModule: Record<string, unknown>): void {
  const modules = [...hmrGlobal.modules.values()]
  for (const module of modules) {
    let changed = false
    for (const [name, proxy] of module.components) {
      const next = nextModule[name]
      if (typeof next !== 'function') continue
      const hmrProxy = proxy as HmrComponent & { current: HmrComponent; displayName?: string }
      hmrProxy.current = next as HmrComponent
      Object.defineProperty(hmrProxy, 'displayName', { configurable: true, value: next.name || name })
      changed = true
    }
    if (!changed) continue
    for (const instance of module.instances) {
      try {
        instance.refresh()
      } catch {
        // HMR failures remain application errors on the next normal render.
      }
    }
  }
}

export function disposeHmrModule(_moduleId: string): void {
  // State and component proxies intentionally survive module disposal.
}

export function createHmrStateStore(moduleId: string): HmrStateStore {
  const state = getModule(moduleId).state
  return {
    get<T>(key: string, initial: T | (() => T)): T {
      if (!state.has(key)) state.set(key, typeof initial === 'function' ? (initial as () => T)() : initial)
      return state.get(key) as T
    },
    set<T>(key: string, value: T): void {
      state.set(key, value)
    },
    has: key => state.has(key),
    delete: key => { state.delete(key) },
    clear: () => { state.clear() }
  }
}

/**
 * 编译器为模块顶层 state() 声明生成的取值入口。键为 `${moduleId}#${声明名}`，
 * 与手动 store 键空间隔离。模块热更新重执行时复用既有信号实例：旧导入方持有的
 * 实例与新模块实例共享同一份状态，消除"两份模块、两份状态"导致的编辑不生效/页面半边失灵。
 */
export function hmrStateRef<T>(key: string, create: () => T): T {
  const states = hmrGlobal.states
  if (states.has(key)) return states.get(key) as T
  const value = create()
  states.set(key, value)
  return value
}

export function registerHmrInstance(moduleId: string, instance: HmrInstance): () => void {
  const instances = getModule(moduleId).instances
  instances.add(instance)
  return () => instances.delete(instance)
}

export function markHmrInstanceMounted(node: VobsNode, parent: Node): void {
  const instance = hmrInstances.get(node as object)
  if (instance) instance.parent = parent
}

function getModule(moduleId: string): HmrModuleState {
  let module = hmrGlobal.modules.get(moduleId)
  if (!module) {
    module = { components: new Map(), state: new Map(), instances: new Set() }
    hmrGlobal.modules.set(moduleId, module)
  }
  return module
}

const hmrInstances = new WeakMap<object, HmrInstance>()

export function associateHmrInstance(node: VobsNode, instance: HmrInstance): void {
  hmrInstances.set(node as object, instance)
}
