import { createTheme, themePlugin } from '@vobs/theme'
import { state } from '@vobs/vobs'

export const theme = createTheme({ defaultMode: 'dark' })

/** Playground-only visual mode; the framework theme context intentionally stays dark-first. */
export const playgroundThemeMode = state<'dark' | 'light'>('dark', 'playground.theme.mode')

export const themePluginInstance = themePlugin({ theme })
