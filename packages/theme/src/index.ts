import { getCurrentOwner, memo, onDispose, renderEffect, state, type ReadableSignal, type Signal, untrack } from '@vobs/reactivity'
import {
  createElement,
  createInjectionKey,
  inject,
  insertBefore,
  provide,
  type InjectionKey,
  type VobsNode,
  type VobsPlugin
} from '@vobs/vobs'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedThemeMode = 'light' | 'dark'
export type ThemePrimitive = string | number | boolean
export type ThemeTokenValue = ThemePrimitive | ThemeTokens | undefined

export interface ThemeTokens {
  readonly [key: string]: ThemeTokenValue
}

export interface BrandTokens {
  readonly primary?: string
  readonly secondary?: string
  readonly accent?: string
  readonly [key: string]: string | undefined
}

export interface ThemeOptions {
  readonly defaultMode?: ThemeMode
  readonly themes?: Partial<Record<ResolvedThemeMode, ThemeTokens>>
  readonly defaultTheme?: ThemeTokens
}

export interface ThemeDehydratedState {
  readonly version: 1
  readonly mode: ThemeMode
  readonly overrides: ThemeTokens
}

export interface ThemeContext {
  readonly theme: ReadableSignal<ThemeTokens>
  readonly brand: ReadableSignal<BrandTokens>
  readonly mode: Signal<ThemeMode>
  readonly resolvedMode: ReadableSignal<ResolvedThemeMode>
  dehydrate(): ThemeDehydratedState
  hydrate(snapshot: unknown): void
  setTheme(theme: ThemeTokens): void
  setMode(mode: ThemeMode): void
  setBrand(brand: Partial<BrandTokens>): void
  registerTheme(mode: ResolvedThemeMode, theme: ThemeTokens): () => void
  dispose(): void
}

export const THEME_KEY: InjectionKey<ThemeContext> = createInjectionKey<ThemeContext>('vobs.theme')

export interface ThemePluginOptions extends ThemeOptions {
  readonly theme?: ThemeContext
}

export interface ThemeBoundaryProps {
  readonly theme?: ThemeTokens
  readonly tokens?: ThemeTokens
  readonly brand?: Partial<BrandTokens>
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
}

export const defaultLightTheme: ThemeTokens = {
  /*
   * Keys are **variable names** (flattenInto passes keys starting with -- through verbatim).
   *
   * This used to be written colorScheme, which flattened to --vobs-colorScheme — but the repo's
   * only consumer (ui/src/styles/base.css: `:root { color-scheme: var(--vobs-color-scheme, dark) }`)
   * reads the hyphenated spelling. The two spellings never met, so that rule always hit its
   * fallback and native controls / scrollbars / body background never followed the theme. Switched
   * to an explicit variable name to match the CSS side (CSS default values live in the same-named
   * variables in ui/src/styles/tokens.css).
   */
  '--vobs-color-scheme': 'light',
  brand: {
    primary: '#2563eb',
    secondary: '#0f766e',
    accent: '#d97706'
  },
  semantic: {
    success: '#15803d',
    warning: '#b45309',
    danger: '#b91c1c',
    info: '#0369a1'
  },
  neutral: {
    background: '#ffffff',
    surface: '#f8fafc',
    foreground: '#172033',
    muted: '#64748b',
    border: '#cbd5e1'
  },
  spacing: {
    sm: '4px',
    md: '8px',
    lg: '16px'
  },
  radius: {
    sm: '2px',
    md: '4px',
    lg: '6px'
  }
}

export const defaultDarkTheme: ThemeTokens = {
  '--vobs-color-scheme': 'dark',
  brand: {
    primary: '#60a5fa',
    secondary: '#2dd4bf',
    accent: '#fbbf24'
  },
  semantic: {
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#38bdf8'
  },
  neutral: {
    background: '#111827',
    surface: '#1f2937',
    foreground: '#f8fafc',
    muted: '#94a3b8',
    border: '#334155'
  },
  spacing: {
    sm: '4px',
    md: '8px',
    lg: '16px'
  },
  radius: {
    sm: '2px',
    md: '4px',
    lg: '6px'
  }
}

const appliedVariables = new WeakMap<HTMLElement, Set<string>>()

export function createTheme(options: ThemeOptions = {}): ThemeContext {
  // Debug names: guard warnings (C210/C211 etc.) reference signal names; an unnamed signal error
  // only shows "(unnamed signal)" and cannot be located
  const mode = state<ThemeMode>(options.defaultMode ?? 'light', 'theme.mode')
  const systemMode = state<ResolvedThemeMode>(readSystemMode(), 'theme.systemMode')
  const themes = state<Record<ResolvedThemeMode, ThemeTokens>>({
    light: mergeThemes(defaultLightTheme, options.defaultTheme ?? {}, options.themes?.light ?? {}),
    dark: mergeThemes(defaultDarkTheme, options.defaultTheme ?? {}, options.themes?.dark ?? {})
  }, 'theme.themes')
  const overrides = state<ThemeTokens>({}, 'theme.overrides')
  const resolvedMode = memo<ResolvedThemeMode>(() => mode.value === 'system' ? systemMode.value : mode.value)
  const theme = memo<ThemeTokens>(() => mergeThemes(themes.value[resolvedMode.value], overrides.value))
  const brand = memo<BrandTokens>(() => {
    const value = theme.value.brand
    return isThemeTokens(value) ? value as BrandTokens : {}
  })
  let disposed = false
  let stopSystemListener: (() => void) | undefined

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => {
      systemMode.value = event.matches ? 'dark' : 'light'
    }
    if (media.addEventListener) {
      media.addEventListener('change', listener)
      stopSystemListener = () => media.removeEventListener('change', listener)
    } else {
      media.addListener(listener)
      stopSystemListener = () => media.removeListener(listener)
    }
  }

  const context: ThemeContext = {
    theme,
    brand,
    mode,
    resolvedMode,

    dehydrate(): ThemeDehydratedState {
      ensureActive()
      return { version: 1, mode: mode.value, overrides: overrides.value }
    },

    hydrate(snapshot: unknown): void {
      ensureActive()
      const restored = parseDehydratedState(snapshot)
      mode.value = restored.mode
      overrides.value = restored.overrides
    },

    setTheme(nextTheme: ThemeTokens): void {
      ensureActive()
      overrides.value = nextTheme
    },

    setMode(nextMode: ThemeMode): void {
      ensureActive()
      // Same rationale as setBrand: setters get called from component effects (App's mode-sync
      // effect reads themeMode then calls setMode), so the write must be inside untrack —
      // otherwise ensureActive's read of mode pulls mode into the caller effect's dependency set,
      // and the subsequent write to mode triggers the VOBS_C210 self-subscription loop
      untrack(() => { mode.value = validateMode(nextMode) })
    },

    setBrand(nextBrand: Partial<BrandTokens>): void {
      ensureActive()
      /*
       * Reads go inside untrack.
       *
       * These setters get called from component effects (very common: switching brand per
       * route/user). They used to read overrides / brand directly inside the effect, so the effect
       * subscribed to its sources; the write then re-triggered itself — measured: after 101 rounds
       * it threw "reactive updates exceeded 100 rounds". A setter must not subscribe to the signal
       * it writes.
       */
      const merged = untrack(() => ({ ...brand.value, ...nextBrand }))
      const current = untrack(() => overrides.value)
      overrides.value = mergeThemes(current, { brand: merged })
    },

    registerTheme(nextMode: ResolvedThemeMode, nextTheme: ThemeTokens): () => void {
      ensureActive()
      // Same as above: reads go in untrack to avoid self-subscription when registering a theme inside an effect
      const previous = untrack(() => themes.value[nextMode])
      themes.value = { ...untrack(() => themes.value), [nextMode]: mergeThemes(previous, nextTheme) }
      return () => {
        if (disposed) return
        themes.value = { ...untrack(() => themes.value), [nextMode]: previous }
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      stopSystemListener?.()
      stopSystemListener = undefined
      theme.dispose()
      brand.dispose()
      resolvedMode.dispose()
      mode.dispose()
      systemMode.dispose()
      themes.dispose()
      overrides.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs Theme: cannot use a disposed context')
  }
}

export function themePlugin(options: ThemePluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/theme',
    version: '0.1.0',
    install(context) {
      const ownedTheme = options.theme ? undefined : createTheme(options)
      const theme = options.theme ?? ownedTheme!
      context.provide(THEME_KEY, theme)
      return () => ownedTheme?.dispose()
    }
  }
}

export function useTheme(): ThemeContext {
  const theme = inject(THEME_KEY)
  if (!theme) throw new Error('Vobs Theme: context not found; install themePlugin first')
  return theme
}

export function ThemeBoundary(props: ThemeBoundaryProps = {}): VobsNode {
  const parent = useTheme()
  const local = createScopedTheme(parent, mergeThemes(
    props.theme ?? {},
    props.tokens ?? {},
    props.brand ? { brand: props.brand } : {}
  ))
  /*
   * `override: true` is **required**, not an optional optimization.
   *
   * `ThemeBoundary`'s semantics is "use a scoped theme within this subtree" — i.e. **shadowing**
   * the parent theme. `themePlugin()` has already registered `THEME_KEY` on the root context, and
   * `provide` throws on duplicate keys by default:
   *   Vobs: injection Symbol(vobs.theme) already exists; pass override: true to overwrite
   * So **any app using ThemeBoundary inside a themePlugin subtree would crash outright**
   * (providers hang off the **current owner**, and `injectFromOwner` walks up the owner chain, so
   * child registrations naturally shadow parents — exactly the scenario override should allow).
   */
  provide(THEME_KEY, local, { override: true })

  const root = createElement('div') as HTMLElement
  renderEffect(() => {
    applyThemeVariables(root, local.theme.value)
    // Same as above: SSR elements have no dataset; skip quietly (mark on client hydration)
    if (root.dataset) root.dataset.vobsMode = local.resolvedMode.value
  })
  const child = typeof props.children === 'function' ? props.children() : props.children
  if (child) insertBefore(root, child, null)
  return root
}

export function flattenTheme(theme: ThemeTokens): Record<string, string> {
  const variables: Record<string, string> = {}
  flattenInto(theme, '', variables)
  return variables
}

function createScopedTheme(parent: ThemeContext, initialOverrides: ThemeTokens): ThemeContext {
  const overrides = state<ThemeTokens>(initialOverrides, 'overrides')
  const theme = memo<ThemeTokens>(() => mergeThemes(parent.theme.value, overrides.value))
  const brand = memo<BrandTokens>(() => {
    const value = theme.value.brand
    return isThemeTokens(value) ? value as BrandTokens : {}
  })
  let disposed = false

  const context: ThemeContext = {
    theme,
    brand,
    mode: parent.mode,
    resolvedMode: parent.resolvedMode,
    dehydrate: parent.dehydrate,
    hydrate: parent.hydrate,
    setTheme(nextTheme): void {
      ensureActive()
      overrides.value = nextTheme
    },
    setMode(nextMode): void {
      ensureActive()
      parent.setMode(nextMode)
    },
    setBrand(nextBrand): void {
      ensureActive()
      /*
       * Reads must go inside `untrack`, otherwise calling this inside an effect is **self-
       * subscription**: `overrides.value` and `brand.value` both participate in computing the new
       * value, and `overrides.value` is written right after — a signal that was just read gets
       * written on the spot; the framework guard reports VOBS_C210 and it really is a loop
       * (measured: a component effect inside a ThemeBoundary subtree calling `setBrand` → runs=101
       * threw "reactive updates exceeded 100 rounds").
       *
       * The root theme implementation (`setBrand` / `registerTheme` at `:202-224` in this file)
       * already did this — **the scoped copy was missing it** — the classic consequence of writing
       * the same logic twice.
       */
      const base = untrack(() => overrides.value)
      const currentBrand = untrack(() => brand.value)
      overrides.value = mergeThemes(base, {
        brand: { ...currentBrand, ...nextBrand }
      })
    },
    registerTheme(nextMode, nextTheme): () => void {
      ensureActive()
      return parent.registerTheme(nextMode, nextTheme)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      theme.dispose()
      brand.dispose()
      overrides.dispose()
    }
  }
  if (getCurrentOwner()) onDispose(context.dispose)
  return context

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs Theme: cannot use a disposed local context')
  }
}

function parseDehydratedState(snapshot: unknown): ThemeDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs Theme: initial state is not valid JSON')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('Vobs Theme: initial state has an invalid format')
  const candidate = value as Partial<ThemeDehydratedState>
  if (candidate.version !== 1 || !candidate.overrides || typeof candidate.overrides !== 'object') {
    throw new Error('Vobs Theme: initial state version or fields are invalid')
  }
  return {
    version: 1,
    mode: validateMode(candidate.mode as ThemeMode),
    overrides: candidate.overrides
  }
}

function applyThemeVariables(root: HTMLElement, theme: ThemeTokens): void {
  /*
   * SSR elements are **pure data objects** (createElementNode at ssr/src/renderer.ts:105: only
   * attrs/props/children — no style, no dataset). This used to write root.style unconditionally,
   * so renderToString threw outright with
   * `Cannot read properties of undefined (reading 'setProperty')` — SSR + theme boundary was
   * entirely unusable, with not a single test case.
   *
   * The server shouldn't write inline variables anyway (a <style>/class should hand that to the
   * client for hydration), so skip quietly.
   */
  if (!root.style) return
  const next = flattenTheme(theme)
  const previous = appliedVariables.get(root) ?? new Set<string>()
  for (const [key, value] of Object.entries(next)) {
    root.style.setProperty(key, value)
    previous.delete(key)
  }
  for (const key of previous) root.style.removeProperty(key)
  appliedVariables.set(root, new Set(Object.keys(next)))
}

function flattenInto(value: ThemeTokenValue, path: string, output: Record<string, string>): void {
  if (value === undefined) return
  if (isThemeTokens(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = key.startsWith('--') ? key : path ? `${path}-${key}` : key
      flattenInto(nested, nextPath, output)
    }
    return
  }
  const variable = path.startsWith('--') ? path : `--vobs-${path}`
  output[variable] = String(value)
}

function mergeThemes(...themes: ThemeTokens[]): ThemeTokens {
  const result: Record<string, ThemeTokenValue> = {}
  for (const theme of themes) {
    for (const [key, value] of Object.entries(theme)) {
      const previous = result[key]
      result[key] = isThemeTokens(previous) && isThemeTokens(value)
        ? mergeThemes(previous, value)
        : value
    }
  }
  return result
}

function isThemeTokens(value: unknown): value is ThemeTokens {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateMode(mode: ThemeMode): ThemeMode {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    throw new Error('Vobs Theme: mode must be light, dark, or system')
  }
  return mode
}

function readSystemMode(): ResolvedThemeMode {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
