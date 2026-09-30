/**
 * DSH 浏览器（客户端）侧的公开契约类型。
 *
 * 这些声明是从已安装的 DSH 客户端实现反推出来的**非官方 API**：DSH 目前不发布
 * 客户端插件类型。字段名与语义已对齐 `@deepseek-ai/dsh-client-ui-slots` 的
 * `ctx.slots.register` 与各官方客户端 bundle 的实际用法，但 DSH 升级后可能漂移。
 * 因此本包只保证「声明保守」：所有 DSH 专有字段都可选，未知字段一律透传。
 */

/** slot 的四种组合形态，对应官方 ui-slots 的 kind。 */
export type DshSlotKind = 'single' | 'list' | 'keyed' | 'chain'

/** 子 slot 声明，注册父 slot 时用来「认领」自己会渲染的区域。 */
export interface DshSlotDeclaration {
  kind: DshSlotKind
  scope?: string
  priority?: number
}

/** 一条 slot 注册项。除 name 外全部可选，未用到的字段不会写进注册对象。 */
export interface DshSlotRegistration {
  /** 目标 slot 名，必须由某个父级插件声明过，例如 `shell.overlay`。 */
  name: string
  /** list/单例型 slot 的稳定标识；与 `key` 二者按 slot 类型取用。 */
  id?: string
  /** keyed slot（如 `main`）的主键；`sidebar.panellist` 用同值做 `id` 来互相关联。 */
  key?: string
  /** 排序权重，越小越靠前。 */
  order?: number
  /** 文案命名空间，交给 DSH 的 locale 服务解析。 */
  locale?: string
  /** 显示文案，或返回文案的函数（DSH 声明了语言切换时会重取）。 */
  label?: string | (() => string)
  /** 该条目对外声明拥有的子 slot。 */
  children?: Record<string, DshSlotDeclaration>
  /** 把运行时可用的数据交给组件；返回值作为组件 props 的一部分。 */
  inject?: () => Record<string, unknown>
  /** 未知字段按原样透传给 DSH，便于在适配层还没覆盖时自行传参。 */
  [key: string]: unknown
}

/** 已注册的 slot 条目（只用到 options，其余字段原样保留）。 */
export interface DshSlotEntry {
  options: DshSlotRegistration
  [key: string]: unknown
}

/** 浏览器侧 cordis 树的 `slots` 服务。 */
export interface DshSlotsService {
  /** 注入目标 slot：目标就绪后回调才会执行，回调的返回值随本插件生命周期销毁。 */
  inject(name: string, callback: () => unknown): void
  /** 注册一个条目；第二个参数是 React 组件（vobs 面板由宿主组件包住）。 */
  register(options: DshSlotRegistration, component: unknown): unknown
  /** 读取某个 slot 上已注册的条目，例如 `entries('main')`。 */
  entries?(name: string): readonly DshSlotEntry[]
  /** 向 root 注入 hooks（官方 layout 用它提供 panelInfo）。 */
  provideRoot?(hooks: unknown): () => void
  [key: string]: unknown
}

/**
 * 客户端 cordis 上下文。只声明本适配层真正用到的成员；
 * `get` / `reflect` / 自定义服务都是可选的，用到时自行断言。
 */
export interface DshClientContext {
  readonly slots: DshSlotsService
  /** cordis 的 effect：回调返回值会在插件销毁时执行。 */
  effect?(callback: () => void | (() => void), label?: string): void
  /** 读取任意已注册服务，例如 `ctx.get('connection')`。 */
  get?(name: string): unknown
  /** 反射注册服务（官方用 `ctx.reflect.provide(name, value)`）。 */
  reflect?: { provide?(name: string, value: unknown): () => void }
  [key: string]: unknown
}

/**
 * 浏览器 cordis 插件。DSH 的客户端模块系统会把 bundle 的默认导出挂到客户端 cordis 树上，
 * 因此这就是 `defineDshPlugin` 的返回值形状。
 */
export interface DshClientPlugin {
  /** 需要先就绪的 cordis 服务名；适配层默认注入 `slots`。 */
  readonly inject: readonly string[]
  apply(ctx: DshClientContext): void
}
