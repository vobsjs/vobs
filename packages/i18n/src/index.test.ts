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

  it('looks up translations by nested key, supporting fallback, missing keys, and param interpolation', () => {
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
   * Interpolation used `key in params` (walking the prototype chain): with empty params,
   * `{constructor}` rendered as `function Object() { [native code] }`, and `{toString}`/`{__proto__}`
   * behaved the same; explicitly passing `undefined`/`null` rendered the literals "undefined"/"null".
   */
  it('interpolation only recognizes own properties; missing/empty params are not rendered as literals', () => {
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
    // Missing params keep the placeholder as-is (consistent with missing-key handling; never silently 'undefined')
    expect(i18n.t('name', { name: undefined })).toBe('V {name}')
    expect(i18n.t('name', { name: null })).toBe('V {name}')
    expect(i18n.t('name', { name: 'Ada' })).toBe('V Ada')
    i18n.dispose()
  })

  /*
   * A missing key used to be **completely silent** (returning the key itself, zero warnings) →
   * downstream could only guess via the `value === key` string comparison, which is exactly what
   * `@vobs/kit` did. This adds an observable hook without **changing** t()'s return value.
   */
  /*
   * ISO strings are the most common time form in JSON payloads; `formatDate('2024-…Z')` used to
   * **silently return an empty string** (only Date/number accepted), so callers just saw "no
   * date". Valid strings are now parsed; invalid ones still yield an empty string.
   */
  /*
   * Unit selection used `Math.round`: 90 minutes = 1.5 hours → rounded up to "2 hours ago".
   * The correct semantics is "take the largest unit whose amount is at least 1" → "1 hour ago".
   */
  it('{v,number}/{v,currency} no longer silently produce an empty string for non-numeric values', () => {
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { num: 'n={v,number}', cur: 'c={v,currency}', ok: 'k={v,number}', bad: 'bad={v,date}', when: 'w={v,date}' } }
    })
    expect(i18n.t('num', { v: 'abc' })).toBe('n=abc')
    expect(i18n.t('cur', { v: 'abc' })).toBe('c=abc')
    expect(i18n.t('ok', { v: 1234.5 })).toContain('1,234.5')
    // Date/relativeTime share the orientation: when the date can't be parsed, show the original value instead of leaving a hole in the copy
    expect(i18n.t('bad', { v: 'not-a-date' })).toBe('bad=not-a-date')
    expect(i18n.t('when', { v: '2024-01-15T00:00:00Z' })).toContain('2024')
    i18n.dispose()
  })

  it('formatRelativeTime never describes 90 minutes as 2 hours (units picked by truncation)', () => {
    const i18n = createI18n({ defaultLocale: 'en-US' })
    const now = new Date('2026-09-03T12:00:00.000Z')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T10:30:00.000Z'), now)).toBe('1 hour ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T10:59:00.000Z'), now)).toBe('1 hour ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T11:01:00.000Z'), now)).toBe('59 minutes ago')
    expect(i18n.formatRelativeTime(new Date('2026-09-03T12:30:00.000Z'), now)).toBe('in 30 minutes')
    // ISO strings are accepted too (most common in JSON payloads); the runtime already goes through toDate, this just completes the typing
    expect(i18n.formatRelativeTime('2026-09-03T10:30:00.000Z', '2026-09-03T12:00:00.000Z')).toBe('1 hour ago')
    i18n.dispose()
  })

  it('formatDate accepts ISO strings (invalid input still yields an empty string)', () => {
    // Use fr-FR: the Intl instance cache is **module-level**; a different locale keeps this from
    // pre-warming the "construction count" test below
    const i18n = createI18n({ defaultLocale: 'fr-FR', timeZone: 'UTC' })
    expect(i18n.formatDate('2024-01-15T00:00:00Z', 'short')).toContain('2024')
    expect(i18n.formatDate('not a date')).toBe('')
    expect(i18n.formatDate(new Date(Number.NaN))).toBe('')
    expect(i18n.formatDate(Number.NaN)).toBe('')
    i18n.dispose()
  })

  /*
   * `t()` returns the key itself when the key is missing, so callers cannot distinguish "missing
   * key" from "the translation happens to equal the key" (which is why `@vobs/kit` had to write
   * `value === key ? fallback : value`). `has(key)` is the answer you can ask for directly.
   */
  it('has(key) distinguishes "missing key" from "translation happens to equal the key"', () => {
    const i18n = createI18n({
      defaultLocale: 'zh-CN',
      fallbackLocale: 'en-US',
      messages: {
        'zh-CN': { 'literal.key': 'literal.key', nested: { deep: '深' } },
        'en-US': { fromFallback: 'From fallback' }
      }
    })

    expect(i18n.has('literal.key')).toBe(true)
    expect(i18n.has('nested.deep')).toBe(true)
    expect(i18n.has('fromFallback')).toBe(true)   // Resolving through the fallback locale also counts
    expect(i18n.has('missing.key')).toBe(false)
    expect(i18n.has('')).toBe(false)
    i18n.dispose()
  })

  it('onMissingKey observes missing keys without changing the return value, and an observer throwing does not affect the result', () => {
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

    // A translation that happens to equal the key must not be treated as missing (exactly the case kit could not distinguish)
    i18n.setMessages('en-US', { 'literal.key': 'literal.key' })
    expect(i18n.t('literal.key')).toBe('literal.key')
    expect(seen).toHaveLength(2)
    i18n.dispose()
  })

  it('a locale change drives nodes using t to update', () => {
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
   * `new Intl.*` is expensive: measured formatDate construction at ≈94.6µs per call vs ≈1.84µs
   * reusing an instance (≈50×). The 5 formatting methods used to construct a new one every call
   * (201/210/217/241/245). This pins the cache via the construction count, far more stable than
   * timing.
   */
  it('reuses Intl instances for the same locale/options (construction is expensive, measured ≈50×)', () => {
    const dateSpy = vi.spyOn(Intl, 'DateTimeFormat')
    const numberSpy = vi.spyOn(Intl, 'NumberFormat')
    const relativeSpy = vi.spyOn(Intl, 'RelativeTimeFormat')
    // Use en-GB: the Intl instance cache is **module-level**; picking a locale no other test in
    // this file uses keeps this test from being "pre-warmed" to 0 constructions by others running
    // first (which would destroy its discriminating power).
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
    // Plain numbers and currency are two different option sets → two instances (each constructed only once)
    expect(numberSpy).toHaveBeenCalledTimes(2)

    dateSpy.mockRestore()
    numberSpy.mockRestore()
    relativeSpy.mockRestore()
    i18n.dispose()
  })

  it('formatting results follow locale switches (the cache is keyed per locale)', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', timeZone: 'UTC' })
    const english = i18n.formatDate(new Date('2024-01-15T00:00:00Z'), { year: 'numeric', month: 'long' })
    i18n.setLocale('de-DE')
    const german = i18n.formatDate(new Date('2024-01-15T00:00:00Z'), { year: 'numeric', month: 'long' })
    expect(english).toContain('January')
    expect(german).toContain('Januar')
    expect(german).not.toBe(english)
    i18n.dispose()
  })

  it('provides date, number, currency, and relative-time formatting', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', timeZone: 'UTC' })

    expect(i18n.formatDate(new Date('2024-01-15T00:00:00Z'), 'short')).toContain('2024')
    expect(i18n.formatNumber(0.85, 'percent')).toContain('85')
    expect(i18n.formatCurrency(100, 'USD')).toContain('$')
    expect(i18n.formatRelativeTime(Date.now() - 60 * 60 * 1000)).toContain('hour')
    i18n.dispose()
  })

  /*
   * `mergeMessages` used to do `merged[key] = value` on a plain object: when the key was
   * `__proto__` that was not a key write but **set the prototype of the merged result** → a
   * payload like `{"__proto__":{"injected":"PWNED"}}` (locale files, server-delivered
   * translations) could make arbitrary keys appear out of nowhere, and `t()` would read the
   * attacker-specified "translation" directly.
   */
  it('a malicious messages payload cannot inject translations via __proto__', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { hello: 'Hello' } } })
    i18n.setMessages('en-US', JSON.parse('{"__proto__":{"injected":"PWNED"}}'))

    expect(i18n.t('hello')).toBe('Hello')
    // Missing keys return the key itself — before the fix this returned 'PWNED'
    expect(i18n.t('injected')).toBe('injected')
    expect((i18n.messages.value['en-US'] as Record<string, unknown>).injected).toBeUndefined()
    // The global prototype must not be polluted either
    expect(({} as Record<string, unknown>).injected).toBeUndefined()
    i18n.dispose()
  })

  it('supports custom formatters and runtime message additions', () => {
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

  it('deduplicates requests and deep-merges namespaces when lazily loading locale resources', async () => {
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

  it('rejects locale resources with no loader or an invalid format', async () => {
    const i18n = createI18n({ defaultLocale: 'en-US' })
    await expect(i18n.loadLocale('zh-CN')).rejects.toThrow('no loader available')
    await expect(i18n.loadLocale('zh-CN', async () => ({ broken: [] as unknown as string }))).rejects.toThrow('invalid value')
    i18n.dispose()
  })

  it('i18nPlugin injects the shared context and I18nBoundary lazy children use the local locale', () => {
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

  it('useI18n gives a clear error when no plugin is installed', () => {
    const app = createVobs({ render: () => {
      void useI18n()
      return createText('')
    }})
    expect(() => app.mount(document.createElement('div'))).toThrow('i18nPlugin')
    expect(I18N_KEY).toBeDefined()
  })
})
