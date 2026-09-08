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
  createI18n,
  I18nBoundary,
  I18N_KEY,
  i18nPlugin,
  useI18n
} from './index'

describe('@vobs/i18n', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('按嵌套 key 查找翻译，支持 fallback、缺失 key 和参数插值', () => {
    const i18n = createI18n({
      defaultLocale: 'zh-CN',
      fallbackLocale: 'en-US',
      messages: {
        'zh-CN': { common: { hello: '你好，{name}' } },
        'en-US': { common: { cancel: 'Cancel' } }
      }
    })

    expect(i18n.t('common.hello', { name: 'Ada' })).toBe('你好，Ada')
    expect(i18n.t('common.cancel')).toBe('Cancel')
    expect(i18n.t('common.missing')).toBe('common.missing')
    i18n.dispose()
  })

  it('locale 变化会驱动使用 t 的节点更新', () => {
    const i18n = createI18n({
      defaultLocale: 'zh-CN',
      messages: {
        'zh-CN': { title: '中文' },
        'en-US': { title: 'English' }
      }
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => {
        const text = createText('')
        bindText(text, () => i18n.t('title'))
        return text
      }
    })

    app.mount(container)
    expect(container.textContent).toBe('中文')
    i18n.setLocale('en-US')
    app.update()
    expect(container.textContent).toBe('English')
    app.destroy()
    i18n.dispose()
  })

  it('提供日期、数字、货币和相对时间格式化', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', timeZone: 'UTC' })

    expect(i18n.formatDate(new Date('2024-01-15T00:00:00Z'), 'short')).toContain('2024')
    expect(i18n.formatNumber(0.85, 'percent')).toContain('85')
    expect(i18n.formatCurrency(100, 'USD')).toContain('$')
    expect(i18n.formatRelativeTime(Date.now() - 60 * 60 * 1000)).toContain('hour')
    i18n.dispose()
  })

  it('支持自定义 formatter 和运行时追加翻译', () => {
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { greeting: 'Hello {name, uppercase}' } }
    })
    const unregister = i18n.registerFormatter('uppercase', value => String(value).toUpperCase())

    expect(i18n.t('greeting', { name: 'Ada' })).toBe('Hello ADA')
    i18n.setMessages('en-US', { added: 'Added' })
    expect(i18n.t('added')).toBe('Added')
    unregister()
    expect(i18n.t('greeting', { name: 'Ada' })).toBe('Hello Ada')
    i18n.dispose()
  })

  it('按需加载语言资源时去重请求并深度合并 namespace', async () => {
    let calls = 0
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { common: { ok: 'OK' } } },
      localeLoaders: {
        'zh-CN': async () => {
          calls++
          return { common: { cancel: '取消' }, page: { title: '首页' } }
        }
      }
    })
    await Promise.all([i18n.loadLocale('zh-CN'), i18n.loadLocale('zh-CN')])
    expect(calls).toBe(1)
    expect(i18n.isLocaleLoaded('zh-CN')).toBe(true)
    i18n.setLocale('zh-CN')
    expect(i18n.t('common.cancel')).toBe('取消')
    expect(i18n.t('page.title')).toBe('首页')
    i18n.dispose()
  })

  it('拒绝没有 loader 或格式错误的语言资源', async () => {
    const i18n = createI18n({ defaultLocale: 'en-US' })
    await expect(i18n.loadLocale('zh-CN')).rejects.toThrow('没有可用的 loader')
    await expect(i18n.loadLocale('zh-CN', async () => ({ broken: [] as unknown as string }))).rejects.toThrow('值无效')
    i18n.dispose()
  })

  it('i18nPlugin 注入共享上下文，I18nBoundary 的惰性 children 使用局部语言', () => {
    const i18n = createI18n({
      defaultLocale: 'zh-CN',
      messages: {
        'zh-CN': { title: '中文' },
        'en-US': { title: 'English' }
      }
    })
    function Child() {
      return createText(useI18n().t('title'))
    }
    const container = document.createElement('div')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        const global = createText(useI18n().t('title'))
        root.append(global)
        const local = createComponent(I18nBoundary, {
          locale: 'en-US',
          children: () => createComponent(Child, {})
        })
        insertBefore(root, local, null)
        return root
      },
      plugins: [i18nPlugin({ i18n })]
    })

    app.mount(container)
    expect(container.textContent).toBe('中文English')
    expect(container.querySelector('div')).toBeTruthy()
    app.destroy()
    i18n.dispose()
  })

  it('没有安装插件时，useI18n 给出明确错误', () => {
    const app = createVobs({ render: () => {
      void useI18n()
      return createText('')
    }})
    expect(() => app.mount(document.createElement('div'))).toThrow('i18nPlugin')
    expect(I18N_KEY).toBeDefined()
  })
})
