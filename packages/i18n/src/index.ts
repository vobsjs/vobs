import { getCurrentOwner, onDispose, state, type Signal } from '@vobs/reactivity'
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
    value: Date | number,
    presetOrOptions?: DatePreset | Intl.DateTimeFormatOptions,
    options?: Intl.DateTimeFormatOptions
  ): string
  formatNumber(value: number, presetOrOptions?: NumberPreset | Intl.NumberFormatOptions): string
  formatCurrency(
    value: number,
    currency: string,
    options?: Omit<Intl.NumberFormatOptions, 'currency' | 'style'>
  ): string
  formatRelativeTime(value: Date | number, now?: Date | number): string
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
      if (template === undefined) return key
      return interpolate(template, params, context, formatters)
    },

    formatDate(value, presetOrOptions, dateOptions): string {
      ensureActive()
      const date = toDate(value)
      if (!date) return ''
      const resolvedOptions = resolveDateOptions(presetOrOptions, dateOptions)
      return new Intl.DateTimeFormat(locale.value, withTimeZone(resolvedOptions, options.timeZone)).format(date)
    },

    formatNumber(value, presetOrOptions): string {
      ensureActive()
      if (!Number.isFinite(value)) return ''
      const numberOptions = typeof presetOrOptions === 'string'
        ? presetOrOptions === 'percent' ? { style: 'percent' as const } : {}
        : presetOrOptions
      return new Intl.NumberFormat(locale.value, numberOptions).format(value)
    },

    formatCurrency(value, currency, currencyOptions): string {
      ensureActive()
      if (!Number.isFinite(value)) return ''
      if (!currency) throw new Error('Vobs I18n: currency 不能为空')
      return new Intl.NumberFormat(locale.value, {
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
      for (const [unit, milliseconds] of units) {
        const amount = Math.round(difference / milliseconds)
        if (Math.abs(amount) >= 1) {
          return new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
            .format(-amount, unit)
        }
      }
      return new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }).format(0, 'second')
    },

    registerFormatter(name: string, formatter: I18nFormatter): () => void {
      ensureActive()
      if (!name) throw new Error('Vobs I18n: formatter 名称不能为空')
      const previous = formatters.get(name)
      formatters.set(name, formatter)
      return () => {
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
  const local = createI18n({
    defaultLocale: props.locale ?? parent.locale.value,
    messages: parent.messages.value,
    fallbackLocale: parent.fallbackLocale,
    timeZone: parent.timeZone
  })
  provide(I18N_KEY, local)

  return createFragment((parentNode, anchor) => {
    const child = typeof props.children === 'function' ? props.children() : props.children
    if (child) insertBefore(parentNode, child, anchor)
  })
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
      if (!(key in params)) return match
      const value = params[key]
      if (!formatter) return String(value)
      if (formatter === 'date') return context.formatDate(toDate(value) ?? Number.NaN, argument as DatePreset | undefined)
      if (formatter === 'number') return context.formatNumber(Number(value))
      if (formatter === 'currency') return context.formatCurrency(Number(value), argument ?? 'USD')
      if (formatter === 'relativeTime') return context.formatRelativeTime(toDate(value) ?? Number.NaN)
      const custom = formatters.get(formatter)
      return custom ? custom(value, context.locale.value, argument) : String(value)
    })
}

function toDate(value: Date | number | unknown): Date | undefined {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === 'number' ? new Date(value) : undefined
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
  const merged: Record<string, MessageValue> = { ...(parent ?? {}) }
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

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))]
}
