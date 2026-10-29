/**
 * Public contract types for DSH's browser (client) side.
 *
 * These declarations are an **unofficial API** reverse-engineered from the installed DSH
 * client implementation: DSH does not currently publish client plugin types. Field names
 * and semantics are aligned with `@deepseek-ai/dsh-client-ui-slots`'s `ctx.slots.register`
 * and the actual usage of the official client bundles, but they may drift when DSH upgrades.
 * This package therefore only promises "conservative declarations": every DSH-specific field
 * is optional, and unknown fields are always passed through.
 */

/** The four slot composition kinds, matching the official ui-slots' kind. */
export type DshSlotKind = 'single' | 'list' | 'keyed' | 'chain'

/** Child slot declaration; used when registering a parent slot to claim the area you will render. */
export interface DshSlotDeclaration {
  kind: DshSlotKind
  scope?: string
  priority?: number
}

/** A slot registration entry. Everything except name is optional; unused fields are not written into the registration object. */
export interface DshSlotRegistration {
  /** Target slot name; must have been declared by some parent plugin, e.g. `shell.overlay`. */
  name: string
  /** Stable identifier for list/single-slot kinds; either this or `key` is used depending on the slot type. */
  id?: string
  /** Primary key of a keyed slot (such as `main`); `sidebar.panellist` uses the same value as `id` to link them. */
  key?: string
  /** Sort weight; smaller comes first. */
  order?: number
  /** Locale namespace, resolved by DSH's locale service. */
  locale?: string
  /** Display label, or a function returning it (DSH re-fetches on language switch). */
  label?: string | (() => string)
  /** Child slots this entry declares it owns. */
  children?: Record<string, DshSlotDeclaration>
  /** Hand runtime-available data to the component; the return value becomes part of the component props. */
  inject?: () => Record<string, unknown>
  /** Unknown fields are passed through to DSH as-is, so you can pass extra params before the adapter covers them. */
  [key: string]: unknown
}

/** A registered slot entry (only options is used; other fields are kept verbatim). */
export interface DshSlotEntry {
  options: DshSlotRegistration
  [key: string]: unknown
}

/** The `slots` service on the browser-side cordis tree. */
export interface DshSlotsService {
  /** Inject into the target slot: the callback runs once the target is ready, and its return value is destroyed with this plugin's lifecycle. */
  inject(name: string, callback: () => unknown): void
  /** Register an entry; the second argument is a React component (the vobs panel is wrapped in a host component). */
  register(options: DshSlotRegistration, component: unknown): unknown
  /** Read the entries registered on a slot, e.g. `entries('main')`. */
  entries?(name: string): readonly DshSlotEntry[]
  /** Inject hooks into root (the official layout uses it to provide panelInfo). */
  provideRoot?(hooks: unknown): () => void
  [key: string]: unknown
}

/**
 * Client cordis context. Only declares the members this adapter actually uses;
 * `get` / `reflect` / custom services are optional — assert them yourself where needed.
 */
export interface DshClientContext {
  readonly slots: DshSlotsService
  /** cordis's effect: the callback's return value runs when the plugin is destroyed. */
  effect?(callback: () => void | (() => void), label?: string): void
  /** Read any registered service, e.g. `ctx.get('connection')`. */
  get?(name: string): unknown
  /** Reflect-register a service (the official code uses `ctx.reflect.provide(name, value)`). */
  reflect?: { provide?(name: string, value: unknown): () => void }
  [key: string]: unknown
}

/**
 * Browser cordis plugin. DSH's client module system mounts the bundle's default export
 * onto the client cordis tree, so this is the shape `defineDshPlugin` returns.
 */
export interface DshClientPlugin {
  /** cordis service names that must be ready first; the adapter injects `slots` by default. */
  readonly inject: readonly string[]
  apply(ctx: DshClientContext): void
}
