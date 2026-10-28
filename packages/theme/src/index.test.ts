import { beforeEach, describe, expect, it } from 'vitest'
import {
  createComponent,
  createDOMRenderer,
  createElement,
  createText,
  createVobs,
  bindText,
  insertBefore,
  setRenderer
} from '@vobs/vobs'
import {
  createTheme,
  flattenTheme,
  THEME_KEY,
  ThemeBoundary,
  themePlugin,
  useTheme
} from './index'

describe('@vobs/theme', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('maps nested tokens to --vobs CSS variables and preserves custom variable names', () => {
    expect(flattenTheme({
      brand: { primary: '#123456' },
      spacing: { md: '8px' },
      '--custom-color': '#fff'
    })).toEqual({
      '--vobs-brand-primary': '#123456',
      '--vobs-spacing-md': '8px',
      '--custom-color': '#fff'
    })
  })

  it('the default theme provides surface tokens usable by the layout layer', () => {
    const theme = createTheme()

    expect(theme.theme.value.neutral).toMatchObject({
      background: '#ffffff',
      surface: '#f8fafc'
    })
    theme.setMode('dark')
    expect(theme.theme.value.neutral).toMatchObject({
      background: '#111827',
      surface: '#1f2937'
    })
    theme.dispose()
  })

  it('ThemeBoundary writes the initial CSS variables and updates them after a mode switch', () => {
    const theme = createTheme({
      defaultMode: 'light',
      themes: {
        light: { '--color-primary': '#ffffff' },
        dark: { '--color-primary': '#000000' }
      }
    })
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(ThemeBoundary, { children: () => createElement('span') }),
      plugins: [themePlugin({ theme })]
    })

    app.mount(container)
    const boundary = container.firstElementChild
    expect(boundary?.getAttribute('style')).toContain('--color-primary: #ffffff')
    theme.setMode('dark')
    app.update()
    expect(boundary?.getAttribute('style')).toContain('--color-primary: #000000')
    app.destroy()
    theme.dispose()
  })

  it('setBrand updates the current theme and a local Boundary only overrides its own subtree', () => {
    const theme = createTheme({ defaultMode: 'light' })
    function BrandText() {
      const text = createText('')
      bindText(text, () => useTheme().brand.value.primary ?? '')
      return text
    }
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const root = createElement('section')
        insertBefore(root, createComponent(ThemeBoundary, {
          children: () => createComponent(BrandText, {})
        }), null)
        insertBefore(root, createComponent(ThemeBoundary, {
          brand: { primary: '#ff0000' },
          children: () => createComponent(BrandText, {})
        }), null)
        return root
      },
      plugins: [themePlugin({ theme })]
    })

    app.mount(container)
    expect(container.textContent).toBe('#2563eb#ff0000')
    theme.setBrand({ primary: '#00ff00' })
    app.update()
    expect(container.textContent).toBe('#00ff00#ff0000')
    const boundaries = container.querySelectorAll('div')
    expect(boundaries[0]?.style.getPropertyValue('--vobs-brand-primary')).toBe('#00ff00')
    expect(boundaries[1]?.style.getPropertyValue('--vobs-brand-primary')).toBe('#ff0000')
    app.destroy()
    theme.dispose()
  })

  it('supports system mode and dynamic theme registration', () => {
    const theme = createTheme({ defaultMode: 'light' })
    const unregister = theme.registerTheme('light', { '--custom': 'yes' })
    expect(theme.theme.value['--custom']).toBe('yes')
    unregister()
    expect(theme.theme.value['--custom']).toBeUndefined()
    theme.setMode('system')
    expect(theme.resolvedMode.value === 'light' || theme.resolvedMode.value === 'dark').toBe(true)
    theme.dispose()
  })

  it('gives a clear error when the theme plugin is not installed', () => {
    const app = createVobs({ render: () => {
      void useTheme()
      return createText('')
    }})
    expect(() => app.mount(document.createElement('div'))).toThrow('themePlugin')
    expect(THEME_KEY).toBeDefined()
  })
})
