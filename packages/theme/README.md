# @vobs/theme

Token-based theming with light/dark/system modes, CSS variable output, and scoped theme boundaries.

## Install

```bash
npm install @vobs/theme
```

## Quick start

```ts
import { createTheme } from '@vobs/theme'

const theme = createTheme({
  defaultMode: 'system',
  themes: {
    light: { brand: { primary: '#2563eb' } },
    dark: { brand: { primary: '#60a5fa' } }
  }
})

theme.resolvedMode.value // 'light' or 'dark', follows prefers-color-scheme
theme.setMode('dark')
theme.theme.value.brand.primary // '#60a5fa'

const unregister = theme.registerTheme('dark', { density: 'compact' })
theme.setBrand({ secondary: '#0f766e' })
unregister()
```

## API

| Signature | Description |
| --- | --- |
| `createTheme(options?: ThemeOptions): ThemeContext` | Creates a theme context; `defaultMode` defaults to `'light'`, themes merge over the built-in defaults. |
| `defaultLightTheme` / `defaultDarkTheme` | Built-in token sets covering brand, semantic, neutral, spacing, and radius tokens. |
| `theme.theme: Signal<ThemeTokens>` | Merged tokens for the resolved mode plus overrides. |
| `theme.brand: Signal<BrandTokens>` | The `brand` branch of the current theme. |
| `theme.mode: Signal<ThemeMode>` | `'light'`, `'dark'`, or `'system'`. |
| `theme.resolvedMode: Signal<ResolvedThemeMode>` | Concrete `'light'` or `'dark'`; follows the OS when mode is `'system'`. |
| `theme.setMode(mode: ThemeMode): void` | Switches the mode. |
| `theme.setTheme(tokens: ThemeTokens): void` | Replaces the user override tokens. |
| `theme.setBrand(brand: Partial<BrandTokens>): void` | Merges brand overrides into the current tokens. |
| `theme.registerTheme(mode: ResolvedThemeMode, tokens: ThemeTokens): () => void` | Extends a mode's tokens at runtime; returns a restore function. |
| `theme.dehydrate()` / `theme.hydrate(snapshot)` | Serializes and restores mode and overrides for SSR. |
| `theme.dispose(): void` | Stops the system preference listener and disposes signals. |
| `themePlugin(options?): VobsPlugin` | Provides the context through `THEME_KEY`. |
| `useTheme(): ThemeContext` | Injects the theme context inside components. |
| `ThemeBoundary(props?: ThemeBoundaryProps): VobsNode` | Renders a scoped element, writes its CSS variables, and overrides tokens for its subtree. |
| `flattenTheme(theme: ThemeTokens): Record<string, string>` | Flattens nested tokens into CSS variable names. |

With `mode` set to `'system'`, `resolvedMode` tracks the OS `prefers-color-scheme` through a live `matchMedia` listener. Nested tokens flatten to `--vobs-*` CSS variables (`brand.primary` becomes `--vobs-brand-primary`); keys that already start with `--` are kept as-is. A `ThemeBoundary` merges the parent theme with its own `theme`, `tokens`, and `brand` props, so overrides stay local to its subtree.

## Types

`ThemeMode`, `ResolvedThemeMode`, `ThemePrimitive`, `ThemeTokenValue`, `ThemeTokens`, `BrandTokens`, `ThemeOptions`, `ThemeContext`, `ThemePluginOptions`, `ThemeBoundaryProps`, `ThemeDehydratedState`
