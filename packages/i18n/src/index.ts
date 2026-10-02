import { effect, getCurrentOwner, onDispose, state, untrack, type Signal } from '@vobs/reactivity'
import {
  createFragment,
  createInjectionKey,
  inject,
  insertBefore,
  provide,
  type InjectionKey,
  type VobsNode,
  type VobsPlugin
} from '@vobs/vobs'

export type Locale = string
export type MessageValue = string | Messages

export interface Messages {
  readonly [key: string]: MessageValue
}

export type LocaleMessages = Readonly<Record<Locale, Messages>>
export type DatePreset = 'short' | 'medium' | 'long' | 'full' | 'custom'
export type NumberPreset = 'decimal' | 'percent'
export type I18nLocaleLoader = () => Promise<Messages>

export interface I18nDehydratedState {
  readonly version: 1
  readonly locale: Locale
  readonly messages: LocaleMessages
}

export type I18nFormatter = (
  value: unknown,
  locale: Locale,
  argument?: string
) => string

export interface I18nOptions {
  readonly defaultLocale: Locale
  readonly messages?: LocaleMessages
  readonly localeLoaders?: Readonly<Record<Locale, I18nLocaleLoader>>
  readonly fallbackLocale?: Locale
  readonly timeZone?: string
  readonly formatters?: Record<string, I18nFormatter>
  /**
   * 找不到 key 时的回调。**行为不变**（仍然返回 key 本身），只是给一个可观测出口。
   *
   * 原来缺 key 是**完全静默**的：下游没有任何办法区分"缺 key"与"译文恰好等于 key"，
   * `@vobs/kit` 只能写成 `value === key ? fallback : value`（`kit/src/resource-page.ts`）。
   */
  readonly onMissingKey?: (key: string, locale: Locale) => void
}

export interface I18nContext {
  readonly locale: Signal<Locale>
  readonly messages: Signal<LocaleMessages>
  readonly fallbackLocale: Locale | undefined
  readonly timeZone: string | undefined
  dehydrate(): I18nDehydratedState
  hydrate(snapshot: unknown): void
  setLocale(locale: Locale): void
  setMessages(locale: Locale, messages: Messages): void
  loadLocale(locale: Locale, loader?: I18nLocaleLoader): Promise<void>
  isLocaleLoaded(locale: Locale): boolean
  t(key: string, params?: Record<string, unknown>): string
  formatDate(
    value: Date | number | string,
    presetOrOptions?: DatePreset | Intl.DateTimeFormatOptions,
    options?: Intl.DateTimeFormatOptions
  ): string
  formatNumber(value: number, presetOrOptions?: NumberPreset | Intl.NumberFormatOptions): string
  formatCurrency(
    value: number,
    currency: string,
    options?: Omit<Intl.NumberFormatOptions, 'currency' | 'style'>
  ): string
  formatRelativeTime(value: Date | number | string, now?: Date | number | string): string
  registerFormatter(name: string, formatter: I18nFormatter): () => void
  dispose(): void
}

export const I18N_KEY: InjectionKey<I18nContext> = createInjectionKey<I18nContext>('vobs.i18n')

export interface I18nPluginOptions extends Omit<I18nOptions, 'defaultLocale'> {
  readonly defaultLocale?: Locale
  readonly i18n?: I18nContext
}

export interface I18nBoundaryProps {
  readonly locale?: Locale
  readonly children?: VobsNode | (() => VobsNode | null | undefined)
}

const DATE_PRESETS: Record<Exclude<DatePreset, 'custom'>, Intl.DateTimeFormatOptions> = {
  short: {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  },
  medium: {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  },
  long: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  },
  full: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }
}

export function createI18n(options: I18nOptions): I18nContext {
  const defaultLocale = validateLocale(options.defaultLocale)
  const fallbackLocale = options.fallbackLocale === undefined
    ? defaultLocale
    : validateLocale(options.fallbackLocale)
  const initialMessages = validateLocaleMessages(options.messages ?? {})
  const locale = state(defaultLocale)
  const messages = state<LocaleMessages>({ ...initialMessages })
  const formatters = new Map<string, I18nFormatter>(Object.entries(options.formatters ?? {}))
  const loadedLocales = new Set(Object.keys(initialMessages))
  const pendingLoads = new Map<string, Promise<void>>()
  let disposed = false

  const context: I18nContext = {
    locale,
    messages,
    fallbackLocale,
    timeZone: options.timeZone,

    dehydrate(): I18nDehydratedState {
      ensureActive()
      return { version: 1, locale: locale.value, messages: messages.value }
    },

    hydrate(snapshot: unknown): void {
      ensureActive()
      const restored = parseDehydratedState(snapshot)
      locale.value = restored.locale
      messages.value = restored.messages
      loadedLocales.clear()
      for (const loadedLocale of Object.keys(restored.messages)) loadedLocales.add(loadedLocale)
    },

    setLocale(nextLocale: Locale): void {
      ensureActive()
      locale.value = validateLocale(nextLocale)
    },

    setMessages(nextLocale: Locale, nextMessages: Messages): void {
      ensureActive()
      const normalizedLocale = validateLocale(nextLocale)
      const normalizedMessages = validateMessages(nextMessages)
      messages.value = {
        ...messages.value,
        [normalizedLocale]: mergeMessages(messages.value[normalizedLocale], normalizedMessages)
      }
      loadedLocales.add(normalizedLocale)
    },

    loadLocale(nextLocale: Locale, loader?: I18nLocaleLoader): Promise<void> {
      ensureActive()
      const normalizedLocale = validateLocale(nextLocale)
      if (loadedLocales.has(normalizedLocale)) return Promise.resolve()
      const pending = pendingLoads.get(normalizedLocale)
      if (pending) return pending
      const source = loader ?? options.localeLoaders?.[normalizedLocale]
      if (!source) return Promise.reject(new Error(`Vobs I18n: locale ${normalizedLocale} 没有可用的 loader`))
      const task = Promise.resolve()
        .then(() => source())
        .then(nextMessages => {
          context.setMessages(normalizedLocale, nextMessages)
        })
        .finally(() => {
          pendingLoads.delete(normalizedLocale)
        })
      pendingLoads.set(normalizedLocale, task)
      return task
    },

    isLocaleLoaded(nextLocale: Locale): boolean {
      ensureActive()
      return loadedLocales.has(validateLocale(nextLocale))
    },

    t(key: string, params?: Record<string, unknown>): string {
      ensureActive()
      if (!key) return ''
      const allMessages = messages.value
      const template = findMessage(allMessages, locale.value, fallbackLocale, key)
      if (template === undefined) {
        // 返回 key 本身（行为不变）；这里只提供可观测出口，观察者抛错不影响 t() 的结果
        try {
          options.onMissingKey?.(key, locale.value)
        } catch {
          // observers cannot break translation lookup
        }
        return key
      }
      return interpolate(template, params, context, formatters)
    },

    formatDate(value, presetOrOptions, dateOptions): string {
      ensureActive()
      const date = toDate(value)
      if (!date) return ''
      const resolvedOptions = withTimeZone(resolveDateOptions(presetOrOptions, dateOptions), options.timeZone)
      return dateFormatter(locale.value, resolvedOptions).format(date)
    },

    formatNumber(value, presetOrOptions): string {
      ensureActive()
      if (!Number.isFinite(value)) return ''
      const numberOptions = typeof presetOrOptions === 'string'
        ? presetOrOptions === 'percent' ? { style: 'percent' as const } : {}
        : presetOrOptions
      return numberFormatter(locale.value, numberOptions).format(value)
    },

    formatCurrency(value, currency, currencyOptions): string {
      ensureActive()
      if (!Number.isFinite(value)) return ''
      if (!currency) throw new Error('Vobs I18n: currency 不能为空')
      return numberFormatter(locale.value, {
        ...currencyOptions,
        style: 'currency',
        currency
      }).format(value)
    },

    formatRelativeTime(value, now = Date.now()): string {
      ensureActive()
      const target = toDate(value)?.getTime()
      const current = toDate(now)?.getTime()
      if (target === undefined || current === undefined) return ''
      const difference = current - target
      const units = [
        ['year', 365 * 24 * 60 * 60 * 1000],
        ['month', 30 * 24 * 60 * 60 * 1000],
        ['day', 24 * 60 * 60 * 1000],
        ['hour', 60 * 60 * 1000],
        ['minute', 60 * 1000],
        ['second', 1000]
      ] as const
      const formatter = relativeTimeFormatter(locale.value)
      for (const [unit, milliseconds] of units) {
        /*
         * 用**截断**而不是四舍五入来挑单位：`Math.round` 会把 90 分钟算成 "2 hours ago"
         * （1.5 → 2），而正确语义是"取最大的、其数量至少为 1 的单位" → 90 分钟就是 "1 hour ago"。
         * 截断同时保证不会因为进位而选到过大的单位。
         */
        const amount = Math.trunc(difference / milliseconds)
        if (Math.abs(amount) >= 1) {
          return formatter.format(-amount, unit)
        }
      }
      return formatter.format(0, 'second')
    },

    registerFormatter(name: string, formatter: I18nFormatter): () => void {
      ensureActive()
      if (!name) throw new Error('Vobs I18n: formatter 名称不能为空')
      const previous = formatters.get(name)
      formatters.set(name, formatter)
      return () => {
        /*
         * 只在"自己那次注册**仍然是当前值**"时才回滚。
         *
         * 原来无条件恢复注册时捕获的 previous，于是同名注册两次后：
         * 注销 A 的句柄会把后来者 B **删掉**；再注销 B 的句柄又把 A **塞回来** ——
         * 一个 `() => void` 能做到"卸不干净 + 复活旧的"。
         *
         * 加上身份判断后是干净的栈式语义：被后来者顶掉的那次注册，其句柄变成 no-op
         * （它确实没生效过）；后来者注销时把前一个恢复回来是正确的；同一句柄重复调用也幂等。
         */
        if (formatters.get(name) !== formatter) return
        if (previous) formatters.set(name, previous)
        else formatters.delete(name)
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      locale.dispose()
      messages.dispose()
      formatters.clear()
      pendingLoads.clear()
    }
  }

  if (getCurrentOwner()) onDispose(context.dispose)
  Object.defineProperty(context, I18N_INTERNALS, {
    value: { formatters, localeLoaders: options.localeLoaders ?? {} } satisfies I18nInternals,
    enumerable: false
  })
  return context

  function ensureActive(): void {
    if (disposed) throw new Error('Vobs I18n: 已销毁的上下文不能继续使用')
  }
}

function parseDehydratedState(snapshot: unknown): I18nDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs I18n: 初始状态不是有效 JSON')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('Vobs I18n: 初始状态格式无效')
  const candidate = value as Partial<I18nDehydratedState>
  if (candidate.version !== 1 || typeof candidate.locale !== 'string'
    || !candidate.messages || typeof candidate.messages !== 'object') {
    throw new Error('Vobs I18n: 初始状态版本或字段无效')
  }
  return {
    version: 1,
    locale: validateLocale(candidate.locale),
      messages: validateLocaleMessages(candidate.messages)
  }
}

export function i18nPlugin(options: I18nPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/i18n',
    version: '0.1.0',
    install(context) {
      const ownedI18n = options.i18n ? undefined : createI18n({
        defaultLocale: options.defaultLocale ?? 'en-US',
        messages: options.messages,
        localeLoaders: options.localeLoaders,
        fallbackLocale: options.fallbackLocale,
        timeZone: options.timeZone,
        formatters: options.formatters
      })
      const i18n = options.i18n ?? ownedI18n!
      context.provide(I18N_KEY, i18n)
      return () => ownedI18n?.dispose()
    }
  }
}

export function useI18n(): I18nContext {
  const i18n = inject(I18N_KEY)
  if (!i18n) throw new Error('Vobs I18n: 找不到上下文，请安装 i18nPlugin')
  return i18n
}

export function I18nBoundary(props: I18nBoundaryProps = {}): VobsNode {
  const parent = useI18n()
  const internals = readI18nInternals(parent)
  const local = createI18n({
    defaultLocale: props.locale ?? parent.locale.value,
    messages: parent.messages.value,
    fallbackLocale: parent.fallbackLocale,
    timeZone: parent.timeZone,
    // 自定义 formatter 与 locale 加载器原来**完全没有继承**：前者让 `{name, shout}` 这类占位符
    // 静默退化成 `String(value)`。这里在创建时把父上下文当前那一份传下去（之后父级新注册的
    // formatter 仍不会出现在已挂载的边界里 —— 那是下一步的事）。
    formatters: Object.fromEntries(internals.formatters),
    localeLoaders: internals.localeLoaders
  })
  provide(I18N_KEY, local)

  /*
   * messages 原来是创建时的**死快照**：父级 `setMessages`/`loadLocale` 之后边界里永远看不到。
   * 让本地 messages 跟着父走，只增量补齐父级新出现的语言（保留子上下文自己 load 的内容）。
   * 读本地值必须 untrack：否则「读自己 + 写自己」会自订阅成死循环。
   */
  effect(() => {
    const parentMessages = parent.messages.value
    untrack(() => {
      const localMessages = local.messages.value
      let changed = false
      const merged: Record<Locale, Messages> = { ...localMessages }
      for (const [name, entries] of Object.entries(parentMessages)) {
        if (merged[name] === entries) continue
        merged[name] = mergeMessages(merged[name], entries)
        changed = true
      }
      if (changed) local.messages.value = merged
    })
  })

  return createFragment((parentNode, anchor) => {
    const child = typeof props.children === 'function' ? props.children() : props.children
    if (child) insertBefore(parentNode, child, anchor)
  })
}

/**
 * 边界要继承、但不属于公开 API 的东西（formatters / localeLoaders）。
 * 用内部符号挂在上下文上，外部上下文（自定义 I18nContext 实现）拿不到就退回空集合。
 */
const I18N_INTERNALS = Symbol('vobs.i18n.internals')

interface I18nInternals {
  readonly formatters: Map<string, I18nFormatter>
  readonly localeLoaders: Readonly<Record<Locale, I18nLocaleLoader>>
}

function readI18nInternals(context: I18nContext): I18nInternals {
  const internals = (context as unknown as Record<symbol, I18nInternals | undefined>)[I18N_INTERNALS]
  return internals ?? { formatters: new Map(), localeLoaders: {} }
}

function findMessage(
  allMessages: LocaleMessages,
  locale: Locale,
  fallbackLocale: Locale | undefined,
  key: string
): string | undefined {
  const locales = unique([
    locale,
    locale.split('-')[0],
    fallbackLocale,
    fallbackLocale?.split('-')[0]
  ])
  for (const candidate of locales) {
    const message = getMessage(allMessages[candidate], key)
    if (message !== undefined) return message
  }
  return undefined
}

function getMessage(messages: Messages | undefined, key: string): string | undefined {
  if (!messages) return undefined
  const direct = messages[key]
  if (typeof direct === 'string') return direct

  let current: MessageValue | undefined = messages
  for (const segment of key.split('.')) {
    if (!isMessages(current)) return undefined
    current = current[segment]
  }
  return typeof current === 'string' ? current : undefined
}

function interpolate(
  template: string,
  params: Record<string, unknown> | undefined,
  context: I18nContext,
  formatters: Map<string, I18nFormatter>
): string {
  if (!params) return template
  return template.replace(/\{([\w.-]+)(?:,\s*([\w-]+)(?:,\s*([^}]+))?)?\}/g,
    (match, key: string, formatter?: string, argument?: string) => {
      /*
       * 只认**自有属性**：原来用 `key in params`（沿原型链）→ 空 params 下 `{constructor}`
       * 渲染出 `function Object() { [native code] }`，`{toString}`/`{__proto__}` 同理。
       * 值本身是 undefined/null 时视同"没给这个参数"，占位符原样留在文案里
       * （与缺 key 的处理一致，而不是静默渲染成字面量 "undefined"/"null"）。
       */
      if (!Object.prototype.hasOwnProperty.call(params, key)) return match
      const value = params[key]
      if (value === undefined || value === null) return match
      if (!formatter) return String(value)
      if (formatter === 'date') {
        return formatTemporal(value, input =>
          context.formatDate(input, argument as DatePreset | undefined))
      }
      if (formatter === 'relativeTime') {
        return formatTemporal(value, input => context.formatRelativeTime(input))
      }
      /*
       * 非数字值原来**静默吐空串**（`Number('abc')` → NaN → formatNumber 返回 ''），整段文案悄悄缺一块。
       * 宁可把原值显示出来让人看见 —— 与"缺 key 时返回 key 本身"同一取向（可见 > 静默丢失）。
       */
      if (formatter === 'number') return formatNumeric(value, numeric => context.formatNumber(numeric))
      if (formatter === 'currency') return formatNumeric(value, numeric => context.formatCurrency(numeric, argument ?? 'USD'))

      const custom = formatters.get(formatter)
      return custom ? custom(value, context.locale.value, argument) : String(value)
    })
}

/** 日期/相对时间类格式化：解析不出日期就原样显示（与 formatNumeric 同一取向）。 */
function formatTemporal(value: unknown, format: (input: Date | number) => string): string {
  const date = toDate(value)
  return date ? format(date) : String(value ?? '')
}

/** 数字类格式化：能转成有限数字就走 Intl，否则原样显示（见 interpolate 里的理由）。 */
function formatNumeric(value: unknown, format: (numeric: number) => string): string {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(numeric) ? format(numeric) : String(value ?? '')
}

function toDate(value: Date | number | string | unknown): Date | undefined {  /*
   * ISO 字符串是 JSON 载荷里最常见的时间形态（`{"createdAt":"2024-01-15T00:00:00Z"}`），
   * 原来这里只认 Date/number → `formatDate('2024-01-15T00:00:00Z')` **静默吐空串**
   * （`if (!date) return ''`），调用方只看到"没有日期"。现在解析合法字符串，非法仍返回 undefined。
   */
  let date: Date | undefined
  if (value instanceof Date) date = new Date(value.getTime())
  else if (typeof value === 'number') date = new Date(value)
  else if (typeof value === 'string') date = new Date(value)
  return date && Number.isFinite(date.getTime()) ? date : undefined
}

function resolveDateOptions(
  presetOrOptions: DatePreset | Intl.DateTimeFormatOptions | undefined,
  options: Intl.DateTimeFormatOptions | undefined
): Intl.DateTimeFormatOptions {
  if (presetOrOptions === undefined) return DATE_PRESETS.medium
  if (typeof presetOrOptions === 'object') return presetOrOptions
  if (presetOrOptions === 'custom') return options ?? {}
  return { ...DATE_PRESETS[presetOrOptions], ...options }
}

function withTimeZone(options: Intl.DateTimeFormatOptions, timeZone: string | undefined): Intl.DateTimeFormatOptions {
  return timeZone && options.timeZone === undefined ? { ...options, timeZone } : options
}

function validateLocale(locale: Locale): Locale {
  if (typeof locale !== 'string' || !locale.trim()) throw new Error('Vobs I18n: locale 不能为空')
  return locale
}

function validateMessages(value: Messages): Messages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vobs I18n: messages 必须是对象')
  }
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === 'string') continue
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error(`Vobs I18n: 翻译字段 ${key} 的值无效`)
    }
    validateMessages(message)
  }
  return value
}

function validateLocaleMessages(value: LocaleMessages): LocaleMessages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vobs I18n: locale messages 必须是对象')
  }
  for (const [locale, messages] of Object.entries(value)) {
    validateLocale(locale)
    validateMessages(messages)
  }
  return value
}

function mergeMessages(parent: Messages | undefined, next: Messages): Messages {
  /*
   * 用 **null 原型**累加：`merged['__proto__'] = value` 在普通对象上不是"写键"而是**设置原型**，
   * 于是 `{"__proto__":{"injected":"PWNED"}}` 这种载荷（locale 文件、服务端下发的翻译）会让合并结果
   * 凭空多出任意键 —— 实测 `t('injected')` 返回攻击者指定的 'PWNED'（而不是 key 本身）。
   * null 原型上 `__proto__` 只是一个普通键；`Object.assign` 也不会触发原型 setter。
   */
  const merged = Object.assign(Object.create(null) as Record<string, MessageValue>, parent ?? {})
  for (const [key, value] of Object.entries(next)) {
    const previous = merged[key]
    merged[key] = typeof value === 'object' && typeof previous === 'object'
      ? mergeMessages(previous, value)
      : value
  }
  return merged
}

function isMessages(value: MessageValue | undefined): value is Messages {
  return Boolean(value) && typeof value === 'object'
}

/*
 * Intl 格式化器构造很贵：实测 `new Intl.DateTimeFormat(...).format()` ≈94.6µs，
 * 复用实例 ≈1.84µs（≈50×）。5 处格式化方法原来每次都新建（201/210/217/241/245）。
 * 这里按 (locale, options) 缓存实例；options 组合来自调用方、理论上无界，
 * 所以缓存有硬上限，超过就整体清空（简单、确定、无淘汰记账）。
 */
const INTL_CACHE_LIMIT = 100
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()
const RELATIVE_TIME_OPTIONS: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }

function cachedIntl<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  if (cache.size >= INTL_CACHE_LIMIT) cache.clear()
  const formatter = create()
  cache.set(key, formatter)
  return formatter
}

/** 稳定的 options → key：键名排序 + 逐值 JSON，避免 `{a,b}` 与 `{b,a}` 被当成两套 options。 */
function optionsCacheKey(options: object | undefined): string {
  if (!options) return ''
  const entries = Object.entries(options).filter(([, value]) => value !== undefined)
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return entries.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('&')
}

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedIntl(dateFormatters, `${locale}|${optionsCacheKey(options)}`,
    () => new Intl.DateTimeFormat(locale, options))
}

function numberFormatter(locale: Locale, options: Intl.NumberFormatOptions | undefined): Intl.NumberFormat {
  return cachedIntl(numberFormatters, `${locale}|${optionsCacheKey(options)}`,
    () => new Intl.NumberFormat(locale, options))
}

function relativeTimeFormatter(locale: Locale): Intl.RelativeTimeFormat {
  return cachedIntl(relativeFormatters, `${locale}|${optionsCacheKey(RELATIVE_TIME_OPTIONS)}`,
    () => new Intl.RelativeTimeFormat(locale, RELATIVE_TIME_OPTIONS))
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))]
}
