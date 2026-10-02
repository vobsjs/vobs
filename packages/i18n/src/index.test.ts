import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  /*
   * 插值原来用 `key in params`（沿原型链找）：空 params 下 `{constructor}` 会渲染出
   * `function Object() { [native code] }`，`{toString}`/`{__proto__}` 同理；而显式传
   * `undefined`/`null` 会渲染成字面量 "undefined"/"null"。
   */
  it('插值只认自有属性，缺失/空值参数不渲染成字面量', () => {
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: {
        'en-US': {
          ctor: 'X {constructor}',
          toStr: 'Y {toString}',
          proto: 'Z {__proto__}',
          name: 'V {name}'
        }
      }
    })

    expect(i18n.t('ctor', {})).toBe('X {constructor}')
    expect(i18n.t('toStr', {})).toBe('Y {toString}')
    expect(i18n.t('proto', {})).toBe('Z {__proto__}')
    // 缺参保持占位符原样（与缺 key 的处理一致，不静默变成 'undefined'）
    expect(i18n.t('name', { name: undefined })).toBe('V {name}')
    expect(i18n.t('name', { name: null })).toBe('V {name}')
    expect(i18n.t('name', { name: 'Ada' })).toBe('V Ada')
    i18n.dispose()
  })

  /*
   * 缺 key 原来**完全静默**（返回 key 本身、零警告）→ 下游只能靠 `value === key` 字符串比较猜，
   * `@vobs/kit` 就是这么写的。这里加一个可观测出口，**不改变** t() 的返回值。
   */
  /*
   * ISO 字符串是 JSON 载荷里最常见的时间形态，原来 `formatDate('2024-…Z')` **静默吐空串**
   * （只认 Date/number），调用方只看到"没有日期"。现在合法字符串会被解析，非法仍为空串。
   */
  /*
   * 单位选择原来用 `Math.round`：90 分钟 = 1.5 小时 → 四舍五入成 "2 hours ago"。
   * 正确语义是"取数量至少为 1 的最大单位" → "1 hour ago"。
   */
  it('formatRelativeTime 不会把 90 分钟说成 2 小时（单位按截断选）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US' })
    const now = new Date('2026-09-03T12:00:00.000Z')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T10:30:00.000Z'), now)).toBe('1 hour ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T10:59:00.000Z'), now)).toBe('1 hour ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T11:01:00.000Z'), now)).toBe('59 minutes ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T12:30:00.000Z'), now)).toBe('in 30 minutes')
    i18n.dispose()
  })

  it('formatDate 接受 ISO 字符串（非法输入仍然是空串）', () => {
    // 用 fr-FR：Intl 实例缓存是**模块级**的，换 locale 才不会给下面那条"构造次数"用例预热掉
    const i18n = createI18n({ defaultLocale: 'fr-FR', timeZone: 'UTC' })
    expect(i18n.formatDate('2024-01-15T00:00:00Z', 'short')).toContain('2024')
    expect(i18n.formatDate('not a date')).toBe('')
    expect(i18n.formatDate(new Date(Number.NaN))).toBe('')
    expect(i18n.formatDate(Number.NaN)).toBe('')
    i18n.dispose()
  })

  it('onMissingKey 能观测到缺 key，但不改变返回值，且观察者抛错不影响结果', () => {
    const seen: string[] = []
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { hello: 'Hello' } },
      onMissingKey: (key, locale) => {
        seen.push(`${key}@${locale}`)
        if (key === 'boom') throw new Error('observer exploded')
      }
    })

    expect(i18n.t('hello')).toBe('Hello')
    expect(i18n.t('missing.one')).toBe('missing.one')
    expect(i18n.t('boom')).toBe('boom')
    expect(seen).toEqual(['missing.one@en-US', 'boom@en-US'])

    // 译文恰好等于 key 时不该被当成缺失（那正是 kit 无法区分的情形）
    i18n.setMessages('en-US', { 'literal.key': 'literal.key' })
    expect(i18n.t('literal.key')).toBe('literal.key')
    expect(seen).toHaveLength(2)
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

  /*
   * `new Intl.*` 很贵：实测 formatDate 每次新建 ≈94.6µs，复用实例 ≈1.84µs（≈50×）。
   * 5 处格式化方法原来每次都新建（201/210/217/241/245）。这里用构造次数直接钉住缓存，
   * 比计时稳定得多。
   */
  it('同 locale/options 复用 Intl 实例（构造昂贵，实测约 50×）', () => {
    const dateSpy = vi.spyOn(Intl, 'DateTimeFormat')
    const numberSpy = vi.spyOn(Intl, 'NumberFormat')
    const relativeSpy = vi.spyOn(Intl, 'RelativeTimeFormat')
    // 用 en-GB：Intl 实例缓存是**模块级**的，换个本文件其它用例都不用的 locale，
    // 这条用例才不会因为别人先跑过而被"预热"成 0 次构造（那样就失去判别力了）。
    const i18n = createI18n({ defaultLocale: 'en-GB', timeZone: 'UTC' })

    const firstDate = i18n.formatDate(new Date('2024-01-15T00:00:00Z'), 'short')
    const firstNumber = i18n.formatNumber(1234.5)
    const firstCurrency = i18n.formatCurrency(9.99, 'USD')
    const firstRelative = i18n.formatRelativeTime(Date.now() - 60 * 60 * 1000)
    for (let index = 0; index < 40; index++) {
      expect(i18n.formatDate(new Date('2024-01-15T00:00:00Z'), 'short')).toBe(firstDate)
      expect(i18n.formatNumber(1234.5)).toBe(firstNumber)
      expect(i18n.formatCurrency(9.99, 'USD')).toBe(firstCurrency)
      expect(i18n.formatRelativeTime(Date.now() - 60 * 60 * 1000)).toBe(firstRelative)
    }

    expect(dateSpy).toHaveBeenCalledTimes(1)
    expect(relativeSpy).toHaveBeenCalledTimes(1)
    // 普通数字与货币是两套 options → 两个实例（各自也只建一次）
    expect(numberSpy).toHaveBeenCalledTimes(2)

    dateSpy.mockRestore()
    numberSpy.mockRestore()
    relativeSpy.mockRestore()
    i18n.dispose()
  })

  it('切语言后格式化结果跟着变（缓存按 locale 分开）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', timeZone: 'UTC' })
    const english = i18n.formatDate(new Date('2024-01-15T00:00:00Z'), { year: 'numeric', month: 'long' })
    i18n.setLocale('de-DE')
    const german = i18n.formatDate(new Date('2024-01-15T00:00:00Z'), { year: 'numeric', month: 'long' })
    expect(english).toContain('January')
    expect(german).toContain('Januar')
    expect(german).not.toBe(english)
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

  /*
   * `mergeMessages` 原来在普通对象上 `merged[key] = value`：键名是 `__proto__` 时那不是写键，
   * 而是**设置合并结果的原型** → 于是 `{"__proto__":{"injected":"PWNED"}}` 这种载荷（locale 文件、
   * 服务端下发的翻译）能让任意键凭空出现，`t()` 直接读到攻击者指定"译文"。
   */
  it('恶意 messages 载荷不能通过 __proto__ 注入翻译', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { hello: 'Hello' } } })
    i18n.setMessages('en-US', JSON.parse('{"__proto__":{"injected":"PWNED"}}'))

    expect(i18n.t('hello')).toBe('Hello')
    // 缺 key 时返回 key 本身 —— 修复前这里返回 'PWNED'
    expect(i18n.t('injected')).toBe('injected')
    expect((i18n.messages.value['en-US'] as Record<string, unknown>).injected).toBeUndefined()
    // 也不得污染全局原型
    expect(({} as Record<string, unknown>).injected).toBeUndefined()
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
