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
   * Callback for a missing key. **Behavior unchanged** (still returns the key itself); this just
   * provides an observable hook.
   *
   * A missing key used to be **completely silent**: downstream code had no way to distinguish
   * "missing key" from "the translation happens to equal the key", so `@vobs/kit` had to write
   * `value === key ? fallback : value` (`kit/src/resource-page.ts`).
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
  /**
   * Whether the key **has a translation** in the current locale (or the fallback locale).
   *
   * The reason it exists: `t()` returns the key itself when the key is missing, so callers cannot
   * distinguish "missing key" from "the translation happens to equal the key" — `@vobs/kit` had to
   * write `value === key ? fallback : value` (`translate` in `kit/src/resource-page.ts`).
   * With this, callers can just ask instead of comparing strings.
   */
  has(key: string): boolean
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
  const locale = state(defaultLocale, 'locale')
  const messages = state<LocaleMessages>({ ...initialMessages }, 'messages')
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
      if (!source) return Promise.reject(new Error(`Vobs I18n: no loader available for locale ${normalizedLocale}`))
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
        // Return the key itself (behavior unchanged); this only offers an observable hook — an
        // observer throwing does not affect t()'s result
        try {
          options.onMissingKey?.(key, locale.value)
        } catch {
          // observers cannot break translation lookup
        }
        return key
      }
      return interpolate(template, params, context, formatters)
    },

    has(key: string): boolean {
      ensureActive()
      if (!key) return false
      // Uses the exact same lookup as t() (current locale → primary language → fallback locale →
      // its primary language), so when has(key) is true, t(key) definitely gets a real translation;
      // a false negative would only mean "the translation happens to equal the key".
      return findMessage(messages.value, locale.value, fallbackLocale, key) !== undefined
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
      if (!currency) throw new Error('Vobs I18n: currency must not be empty')
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
         * Pick the unit by **truncation** instead of rounding: `Math.round` turns 90 minutes into
         * "2 hours ago" (1.5 → 2), while the correct semantics is "take the largest unit whose
         * amount is at least 1" → 90 minutes is "1 hour ago". Truncation also guarantees we never
         * pick a too-large unit via carry.
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
      if (!name) throw new Error('Vobs I18n: formatter name must not be empty')
      const previous = formatters.get(name)
      formatters.set(name, formatter)
      return () => {
        /*
         * Roll back only when "our own registration **is still the current value**".
         *
         * The old code unconditionally restored the `previous` captured at registration time, so
         * after two same-name registrations: unregistering A's handle **deleted** the later B;
         * unregistering B's handle then **brought A back** — a single `() => void` could achieve
         * "never fully unregisters + resurrects the old one".
         *
         * With the identity check it's a clean stack discipline: a registration displaced by a
         * later one gets a no-op handle (it indeed never took effect); when the later one
         * unregisters, restoring the previous one is correct; and calling the same handle twice is
         * idempotent.
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
    if (disposed) throw new Error('Vobs I18n: cannot use a disposed context')
  }
}

function parseDehydratedState(snapshot: unknown): I18nDehydratedState {
  let value: unknown = snapshot
  if (typeof snapshot === 'string') {
    try {
      value = JSON.parse(snapshot)
    } catch {
      throw new Error('Vobs I18n: initial state is not valid JSON')
    }
  }
  if (!value || typeof value !== 'object') throw new Error('Vobs I18n: initial state has an invalid format')
  const candidate = value as Partial<I18nDehydratedState>
  if (candidate.version !== 1 || typeof candidate.locale !== 'string'
    || !candidate.messages || typeof candidate.messages !== 'object') {
    throw new Error('Vobs I18n: initial state version or fields are invalid')
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
  if (!i18n) throw new Error('Vobs I18n: context not found; install i18nPlugin first')
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
    // Custom formatters and locale loaders were **not inherited at all**: the former silently
    // degraded placeholders like `{name, shout}` to `String(value)`. Here the parent context's
    // current set is passed down at creation time (formatters the parent registers later still
    // won't appear in an already-mounted boundary — that's a next step).
    formatters: Object.fromEntries(internals.formatters),
    localeLoaders: internals.localeLoaders
  })
  provide(I18N_KEY, local)

  /*
   * `locale` **follows the parent** by default.
   *
   * `defaultLocale: props.locale ?? parent.locale.value` used to read the parent **only once, at
   * creation**, so after the parent called `setLocale('zh-CN')` the boundary never saw it
   * (contrast the `messages` sync effect below). Consequence: the outer app switches language but
   * the copy inside the `I18nBoundary` subtree stays in the old language — and a boundary without
   * an explicit `locale` is precisely the "inherit from parent" usage.
   *
   * `following` instead of "write every time": once the client calls `setLocale` itself inside the
   * boundary it must **stop following** (that's its explicit decision), otherwise the user's
   * choice would be overwritten by the parent at any moment.
   *
   * ⚠️ Reads of the **local** signal must be `untrack`: this effect's job is "bring the parent's
   * value over", so it should only depend on `parent.locale`. If it casually reads
   * `local.locale.value` for the equality check, that read creates a subscription, and the write
   * right after reschedules it — **self-subscription**. This was caught by `vobs check`
   * (`VOBS_C210`): I originally believed the `!following` guard blocked it, but the guard only
   * skips the **first** write; the read still created the dependency. Moving the equality check
   * inside untrack keeps the semantics and cleans the dependency graph.
   */
  let following = props.locale === undefined
  effect(() => {
    const parentLocale = parent.locale.value
    if (!following) return
    untrack(() => {
      if (local.locale.value !== parentLocale) local.locale.value = parentLocale
    })
  })
  // An explicit setLocale inside the boundary = stop following
  const setLocalLocale = local.setLocale
  local.setLocale = (nextLocale: Locale): void => {
    following = false
    setLocalLocale(nextLocale)
  }

  /*
   * `messages` used to be a **dead snapshot** taken at creation: after the parent's
   * `setMessages`/`loadLocale`, the boundary never saw the updates. Make the local messages follow
   * the parent, only incrementally adding languages newly appearing on the parent (keeping what
   * the child context loaded itself).
   * Reading the local value must be untracked: otherwise "read self + write self" self-subscribes
   * into an infinite loop.
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
 * What the boundary inherits but that is not public API (formatters / localeLoaders).
 * Attached to the context via an internal symbol; external contexts (custom I18nContext
 * implementations) fall back to empty collections when they can't provide it.
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
       * Only **own properties** count: the old `key in params` walked the prototype chain, so with
       * empty params `{constructor}` rendered as `function Object() { [native code] }`, and
       * `{toString}`/`{__proto__}` behaved the same. When the value itself is undefined/null it is
       * treated as "this parameter was not given" and the placeholder stays in the copy
       * (consistent with the missing-key handling, instead of silently rendering the literals
       * "undefined"/"null").
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
       * Non-numeric values used to **silently produce an empty string** (`Number('abc')` → NaN →
       * formatNumber returns ''), quietly leaving a hole in the copy. Better to show the original
       * value so someone notices — same orientation as "return the key itself when missing"
       * (visible > silently lost).
       */
      if (formatter === 'number') return formatNumeric(value, numeric => context.formatNumber(numeric))
      if (formatter === 'currency') return formatNumeric(value, numeric => context.formatCurrency(numeric, argument ?? 'USD'))

      const custom = formatters.get(formatter)
      return custom ? custom(value, context.locale.value, argument) : String(value)
    })
}

/** Date/relative-time formatting: display the value as-is when it can't be parsed as a date (same orientation as formatNumeric). */
function formatTemporal(value: unknown, format: (input: Date | number) => string): string {
  const date = toDate(value)
  return date ? format(date) : String(value ?? '')
}

/** Numeric formatting: run through Intl when convertible to a finite number, otherwise display as-is (see the rationale in interpolate). */
function formatNumeric(value: unknown, format: (numeric: number) => string): string {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(numeric) ? format(numeric) : String(value ?? '')
}

function toDate(value: Date | number | string | unknown): Date | undefined {  /*
   * ISO strings are the most common time form in JSON payloads (`{"createdAt":"2024-01-15T00:00:00Z"}`);
   * the old code only accepted Date/number → `formatDate('2024-01-15T00:00:00Z')` **silently
   * returned an empty string** (`if (!date) return ''`), and callers just saw "no date". Valid
   * strings are now parsed; invalid ones still return undefined.
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
  if (typeof locale !== 'string' || !locale.trim()) throw new Error('Vobs I18n: locale must not be empty')
  return locale
}

function validateMessages(value: Messages): Messages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vobs I18n: messages must be an object')
  }
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === 'string') continue
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error(`Vobs I18n: invalid value for translation entry ${key}`)
    }
    validateMessages(message)
  }
  return value
}

function validateLocaleMessages(value: LocaleMessages): LocaleMessages {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vobs I18n: locale messages must be an object')
  }
  for (const [locale, messages] of Object.entries(value)) {
    validateLocale(locale)
    validateMessages(messages)
  }
  return value
}

function mergeMessages(parent: Messages | undefined, next: Messages): Messages {
  /*
   * Accumulate on a **null prototype**: on a plain object, `merged['__proto__'] = value` is not a
   * key write but **sets the prototype**, so a payload like `{"__proto__":{"injected":"PWNED"}}`
   * (locale files, server-delivered translations) would make the merged result sprout arbitrary
   * keys — measured: `t('injected')` returned the attacker-specified 'PWNED' (instead of the key
   * itself). On a null prototype `__proto__` is just an ordinary key; `Object.assign` also never
   * triggers the prototype setter.
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
 * Intl formatter construction is expensive: measured `new Intl.DateTimeFormat(...).format()` at
 * ≈94.6µs vs ≈1.84µs reusing an instance (≈50×). The 5 formatting methods used to construct a new
 * one every call (201/210/217/241/245). Instances are cached by (locale, options); the options
 * combinations come from callers and are theoretically unbounded, so the cache has a hard cap —
 * past it, clear everything (simple, deterministic, no eviction bookkeeping).
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

/** Stable options → key: sort key names + JSON per value, so `{a,b}` and `{b,a}` aren't treated as two different option sets. */
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
