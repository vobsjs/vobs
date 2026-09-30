import type { VobsNode } from '@vobs/vobs'
import {
  createVobsSlotHost,
  DEFAULT_ICON_HOST_STYLE,
  DEFAULT_OVERLAY_HOST_STYLE,
  DEFAULT_PANEL_HOST_STYLE,
  type DshSurfaceOptions
} from './host.js'
import type { DshClientContext, DshClientPlugin, DshSlotRegistration } from './types.js'

/** 适配层默认依赖的客户端服务。 */
const BASE_INJECT = ['slots'] as const

/** 通用插件定义：想自己写 apply 时的逃生口。 */
export interface DshPluginSpec {
  /** 额外注入的客户端服务名，会和 `slots` 合并去重。 */
  inject?: readonly string[]
  /** 插件主体；返回的函数在插件销毁时执行。 */
  setup(ctx: DshClientContext): void | (() => void)
}

/**
 * 定义一个 DSH 客户端插件。
 *
 * 与手写 `{ inject, apply }` 的区别：自动注入 `slots`、自动把 setup 返回的清理函数
 * 挂到 cordis 的 effect 上，因此不需要调用方理解 cordis 的生命周期细节。
 *
 * @param spec - 注入列表与 setup 主体
 * @returns 可直接作为 bundle 默认导出的插件对象
 */
export function defineDshPlugin(spec: DshPluginSpec): DshClientPlugin {
  const inject = [...new Set<string>([...BASE_INJECT, ...(spec.inject ?? [])])]

  return {
    inject,
    apply(ctx: DshClientContext): void {
      const dispose = spec.setup(ctx)
      if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
        ctx.effect(() => dispose)
      }
    }
  }
}

/** 把一次 slot 注册挂到目标 slot 就绪之后。 */
function registerInSlot(ctx: DshClientContext, options: DshSlotRegistration, component: unknown): void {
  ctx.slots.inject(options.name, () => ctx.slots.register(options, component))
}

/** 只挑出宿主外观相关的字段，避免把 slot 自己的选项混进样式配置。 */
function surfaceOf(options: DshSurfaceOptions): DshSurfaceOptions {
  const surface: DshSurfaceOptions = {}
  if (options.styles !== undefined) surface.styles = options.styles
  if (options.hostStyle !== undefined) surface.hostStyle = options.hostStyle
  if (options.scheme !== undefined) surface.scheme = options.scheme
  return surface
}

/** 面板与浮层共有的注册期选项。 */
export interface DshSurfaceRegistrationOptions {
  /**
   * 注册**之前**用客户端上下文准备状态。
   *
   * 视图组件由 DSH 在打开面板时才渲染，而本回调在插件加载时就执行，
   * 因此可以在里面探测客户端服务、建立数据源、读取连接状态，
   * 把结果放进信号里供视图绑定。
   *
   * 返回值是销毁时的清理函数（例如停掉定时器、断开订阅），
   * 由适配层挂到 cordis 的 effect 上。
   */
  setup?: (ctx: DshClientContext) => void | (() => void)
}

/** 浮层（`shell.overlay`）选项。 */
export interface DshOverlayOptions extends DshSurfaceOptions, DshSurfaceRegistrationOptions {
  /** 条目 id，同一个插件注册多个浮层时用来区分。默认 `vobs-overlay`。 */
  id?: string
  /** 排序权重，越小越靠前。默认 100。 */
  order?: number
  /** 文案命名空间。 */
  locale?: string
  /** 显示文案。 */
  label?: string | (() => string)
  /** 额外注入的客户端服务。 */
  injectServices?: readonly string[]
}

/**
 * 注册一个全局浮层。DSH 自家的配额提示、插件管理器 toast 都挂在 `shell.overlay` 上。
 *
 * @param options - 定位、样式与条目选项
 * @param render - vobs 渲染函数
 */
export function defineDshOverlay(options: DshOverlayOptions, render: () => VobsNode): DshClientPlugin {
  const host = createVobsSlotHost(render, {
    ...surfaceOf(options),
    hostStyle: options.hostStyle ?? DEFAULT_OVERLAY_HOST_STYLE
  })

  const registration: DshSlotRegistration = {
    name: 'shell.overlay',
    id: options.id ?? 'vobs-overlay',
    order: options.order ?? 100
  }
  if (options.locale !== undefined) registration.locale = options.locale
  if (options.label !== undefined) registration.label = options.label

  return defineDshPlugin({
    inject: options.injectServices,
    setup(ctx) {
      const dispose = options.setup?.(ctx)
      registerInSlot(ctx, registration, host)
      return dispose
    }
  })
}

/** 主区域整页面板（`main` + 可选侧栏入口）选项。 */
export interface DshPanelOptions extends DshSurfaceOptions, DshSurfaceRegistrationOptions {
  /** keyed `main` slot 的主键，必须与侧栏入口 id 一致才能关联。 */
  key: string
  /** 排序权重。默认 10。 */
  order?: number
  /** 文案命名空间。 */
  locale?: string
  /** 面板标题。 */
  label?: string | (() => string)
  /** 同时在 `sidebar.panellist` 注册入口图标。 */
  sidebarEntry?: {
    /** 入口 id，默认与 `key` 相同。 */
    id?: string
    order?: number
    label: string | (() => string)
    /** 用 vobs 画的图标；同样是独立 shadow root。 */
    renderIcon: () => VobsNode
    /** 图标宿主样式，默认铺满。 */
    hostStyle?: DshSurfaceOptions['hostStyle']
  }
  /** 额外注入的客户端服务。 */
  injectServices?: readonly string[]
}

/**
 * 注册一个占满 DSH 主区域的整页面板，可选在左侧栏加一个入口图标。
 *
 * 对应官方 `dsh-client-ui-schedule` 的注册方式：
 *   `main` 是 keyed slot，用 `key` 认领；`sidebar.panellist` 用同值做 `id` 与之关联。
 *
 * @param options - 主键、条目与样式选项
 * @param render - vobs 渲染函数
 */
export function defineDshPanel(options: DshPanelOptions, render: () => VobsNode): DshClientPlugin {
  const host = createVobsSlotHost(render, {
    ...surfaceOf(options),
    hostStyle: options.hostStyle ?? DEFAULT_PANEL_HOST_STYLE
  })

  const panel: DshSlotRegistration = {
    name: 'main',
    key: options.key,
    order: options.order ?? 10
  }
  if (options.locale !== undefined) panel.locale = options.locale
  if (options.label !== undefined) panel.label = options.label

  const entry = options.sidebarEntry
  const iconHost = entry
    ? createVobsSlotHost(entry.renderIcon, {
        hostStyle: entry.hostStyle ?? DEFAULT_ICON_HOST_STYLE
      })
    : undefined
  const panellist: DshSlotRegistration | undefined =
    entry === undefined
      ? undefined
      : {
          name: 'sidebar.panellist',
          id: entry.id ?? options.key,
          order: entry.order ?? panel.order ?? 10,
          label: entry.label
        }

  return defineDshPlugin({
    inject: options.injectServices,
    setup(ctx) {
      const dispose = options.setup?.(ctx)
      registerInSlot(ctx, panel, host)
      if (panellist && iconHost) registerInSlot(ctx, panellist, iconHost)
      return dispose
    }
  })
}
