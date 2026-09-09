import { getCurrentOwner, memo, onDispose, renderEffect, state, type ReadableSignal, type Signal } from '@vobs/reactivity'
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
  colorScheme: 'light',
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
  colorScheme: 'dark',
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
  const mode = state<ThemeMode>(options.defaultMode ?? 'light')
  const systemMode = state<ResolvedThemeMode>(readSystemMode())
  const themes = state<Record<ResolvedThemeMode, ThemeTokens>>({
    light: mergeThemes(defaultLightTheme, options.defaultTheme ?? {}, options.themes?.light ?? {}),
    dark: mergeThemes(defaultDarkTheme, options.defaultTheme ?? {}, options.themes?.dark ?? {})
  })
  const overrides = state<ThemeTokens>({})
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
      mode.value = validateMode(nextMode)
    },

    setBrand(nextBrand: Partial<BrandTokens>): void {
      ensureActive()
      overrides.value = mergeThemes(overrides.value, {
        brand: {
          ...brand.value,
          ...nextBrand
        }
      })
    },

    registerTheme(nextMode: ResolvedThemeMode, nextTheme: ThemeTokens): () => void {
      ensureActive()
      const previous = themes.value[nextMode]
      themes.value = {
        ...themes.value,
        [nextMode]: mergeThemes(previous, nextTheme)
      }
      return () => {
        if (disposed) return
        themes.value = { ...themes.value, [nextMode]: previous }
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
    if (disposed) throw new Error('Vobs Theme: 已销毁的上下文不能继续使用')
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
  if (!theme) throw new Error('Vobs Theme: 找不到上下文，请安装 themePlugin')
  return theme
}

export function ThemeBoundary(props: ThemeBoundaryProps = {}): VobsNode {
  const parent = useTheme()
  const local = createScopedTheme(parent, mergeThemes(
    props.theme ?? {},
    props.tokens ?? {},
    props.brand ? { brand: props.brand } : {}
  ))
  provide(THEME_KEY, local)

  const root = createElement('div') as HTMLElement
  renderEffect(() => {
    applyThemeVariables(root, local.theme.value)
    root.dataset.vobsMode = local.resolvedMode.value
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
  const overrides = state<ThemeTokens>(initialOverrides)
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
      overrides.value = mergeThemes(overrides.value, {
        brand: { ...brand.value, ...nextBrand }
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
    if (disposed) throw new Error('Vobs Theme: 已销毁的局部上下文不能继续使用')
  }
}

function parseDehydratedState(snapshot: unknown): ThemeDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs Theme: 初始状态不是有效 JSON')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('Vobs Theme: 初始状态格式无效')
  const candidate = value as Partial<ThemeDehydratedState>
  if (candidate.version !== 1 || !candidate.overrides || typeof candidate.overrides !== 'object') {
    throw new Error('Vobs Theme: 初始状态版本或字段无效')
  }
  return {
    version: 1,
    mode: validateMode(candidate.mode as ThemeMode),
    overrides: candidate.overrides
  }
}

function applyThemeVariables(root: HTMLElement, theme: ThemeTokens): void {
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
    throw new Error('Vobs Theme: mode 必须是 light、dark 或 system')
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
