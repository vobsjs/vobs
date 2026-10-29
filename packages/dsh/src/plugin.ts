import type { VobsNode } from '@vobs/vobs'
import {
  createVobsSlotHost,
  DEFAULT_ICON_HOST_STYLE,
  DEFAULT_OVERLAY_HOST_STYLE,
  DEFAULT_PANEL_HOST_STYLE,
  type DshSurfaceOptions
} from './host.js'
import type { DshClientContext, DshClientPlugin, DshSlotRegistration } from './types.js'

/** Client services the adapter depends on by default. */
const BASE_INJECT = ['slots'] as const

/** Generic plugin definition: the escape hatch for writing your own apply. */
export interface DshPluginSpec {
  /** Extra client service names to inject; merged and deduplicated with `slots`. */
  inject?: readonly string[]
  /** Plugin body; the returned function runs when the plugin is destroyed. */
  setup(ctx: DshClientContext): void | (() => void)
}

/**
 * Define a DSH client plugin.
 *
 * Compared to hand-writing `{ inject, apply }`: it injects `slots` automatically and hooks
 * the cleanup function returned by setup into cordis's effect, so callers never need to
 * understand cordis's lifecycle details.
 *
 * @param spec - injection list and setup body
 * @returns A plugin object usable directly as the bundle's default export
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

/** Attach a slot registration to the moment the target slot becomes ready. */
function registerInSlot(ctx: DshClientContext, options: DshSlotRegistration, component: unknown): void {
  ctx.slots.inject(options.name, () => ctx.slots.register(options, component))
}

/** Pick only the host-appearance fields, keeping slot-specific options out of the style config. */
function surfaceOf(options: DshSurfaceOptions): DshSurfaceOptions {
  const surface: DshSurfaceOptions = {}
  if (options.styles !== undefined) surface.styles = options.styles
  if (options.hostStyle !== undefined) surface.hostStyle = options.hostStyle
  if (options.scheme !== undefined) surface.scheme = options.scheme
  return surface
}

/** Registration-time options shared by panels and overlays. */
export interface DshSurfaceRegistrationOptions {
  /**
   * Prepare state with the client context **before** registration.
   *
   * The view component is only rendered by DSH when the panel opens, while this callback
   * runs as soon as the plugin loads. Use it to probe client services, build data sources,
   * read connection state, and store results in signals for the view to bind.
   *
   * The return value is a cleanup function invoked on destroy (e.g. stopping timers,
   * tearing down subscriptions), hooked into cordis's effect by the adapter.
   */
  setup?: (ctx: DshClientContext) => void | (() => void)
}

/** Options for an overlay (`shell.overlay`). */
export interface DshOverlayOptions extends DshSurfaceOptions, DshSurfaceRegistrationOptions {
  /** Entry id; distinguishes multiple overlays registered by the same plugin. Defaults to `vobs-overlay`. */
  id?: string
  /** Sort weight; smaller comes first. Defaults to 100. */
  order?: number
  /** Locale namespace. */
  locale?: string
  /** Display label. */
  label?: string | (() => string)
  /** Extra client services to inject. */
  injectServices?: readonly string[]
}

/**
 * Register a global overlay. DSH's own quota hints and plugin-manager toasts all hang on `shell.overlay`.
 *
 * @param options - positioning, style and entry options
 * @param render - vobs render function
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

/** Options for a full-page panel in the main area (`main` + optional sidebar entry). */
export interface DshPanelOptions extends DshSurfaceOptions, DshSurfaceRegistrationOptions {
  /** Primary key of the keyed `main` slot; must match the sidebar entry id for the two to be linked. */
  key: string
  /** Sort weight. Defaults to 10. */
  order?: number
  /** Locale namespace. */
  locale?: string
  /** Panel title. */
  label?: string | (() => string)
  /** Also register an entry icon under `sidebar.panellist`. */
  sidebarEntry?: {
    /** Entry id; defaults to the same value as `key`. */
    id?: string
    order?: number
    label: string | (() => string)
    /** Icon drawn with vobs; also an independent shadow root. */
    renderIcon: () => VobsNode
    /** Icon host style; fills by default. */
    hostStyle?: DshSurfaceOptions['hostStyle']
  }
  /** Extra client services to inject. */
  injectServices?: readonly string[]
}

/**
 * Register a full-page panel filling DSH's main area, optionally with a sidebar entry icon.
 *
 * Mirrors the registration style of the official `dsh-client-ui-schedule`:
 *   `main` is a keyed slot claimed with `key`; `sidebar.panellist` uses the same value
 *   as `id` so the two are linked.
 *
 * @param options - key, entry and style options
 * @param render - vobs render function
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
