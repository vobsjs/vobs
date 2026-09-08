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

  it('嵌套令牌映射为 --vobs CSS 变量，并保留自定义变量名', () => {
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

  it('默认主题提供可供布局层使用的 surface token', () => {
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

  it('ThemeBoundary 写入初始 CSS 变量，切换 mode 后更新变量', () => {
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

  it('setBrand 更新当前主题，局部 Boundary 只覆盖自己的子树', () => {
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

  it('支持 system mode 和动态注册主题', () => {
    const theme = createTheme({ defaultMode: 'light' })
    const unregister = theme.registerTheme('light', { '--custom': 'yes' })
    expect(theme.theme.value['--custom']).toBe('yes')
    unregister()
    expect(theme.theme.value['--custom']).toBeUndefined()
    theme.setMode('system')
    expect(theme.resolvedMode.value === 'light' || theme.resolvedMode.value === 'dark').toBe(true)
    theme.dispose()
  })

  it('未安装主题插件时给出明确错误', () => {
    const app = createVobs({ render: () => {
      void useTheme()
      return createText('')
    }})
    expect(() => app.mount(document.createElement('div'))).toThrow('themePlugin')
    expect(THEME_KEY).toBeDefined()
  })
})
