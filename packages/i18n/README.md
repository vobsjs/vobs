# @vobs/i18n

Reactive i18n context with nested message lookup, a locale fallback chain, and Intl-based formatting.

## Install

```bash
npm install @vobs/i18n
```

## Quick start

```ts
import { createI18n } from '@vobs/i18n'

const i18n = createI18n({
  defaultLocale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': { common: { hello: '你好，{name}' } },
    'en-US': { common: { cancel: 'Cancel' } }
  }
})

i18n.t('common.hello', { name: 'Ada' }) // '你好，Ada'
i18n.t('common.cancel') // 'Cancel' — resolved through the fallback chain
i18n.setLocale('en-US')
i18n.formatDate(new Date(), 'short')
```

## API

| Signature | Description |
| --- | --- |
| `createI18n(options: I18nOptions): I18nContext` | Creates an i18n context; `defaultLocale` is required. |
| `i18n.locale: Signal<Locale>` | Reactive current locale. |
| `i18n.messages: Signal<LocaleMessages>` | Reactive message catalogs per locale. |
| `i18n.t(key: string, params?): string` | Translates a dotted key with `{param}` interpolation; returns the key itself when missing. |
| `i18n.setLocale(locale: Locale): void` | Switches the locale. |
| `i18n.setMessages(locale: Locale, messages: Messages): void` | Deep-merges messages into an existing catalog. |
| `i18n.loadLocale(locale: Locale, loader?): Promise<void>` | Loads a catalog lazily; concurrent calls for one locale share a single request. |
| `i18n.isLocaleLoaded(locale: Locale): boolean` | Whether the catalog is already loaded. |
| `i18n.formatDate(value, presetOrOptions?, options?): string` | Presets `short`, `medium`, `long`, `full`, `custom`; honors `options.timeZone`. |
| `i18n.formatNumber(value, presetOrOptions?): string` | Presets `decimal` and `percent`, or `Intl.NumberFormatOptions`. |
| `i18n.formatCurrency(value: number, currency: string, options?): string` | Currency formatting via `Intl`. |
| `i18n.formatRelativeTime(value, now?): string` | Relative time via `Intl.RelativeTimeFormat`. |
| `i18n.registerFormatter(name, formatter): () => void` | Registers a custom `{value, name, argument}` placeholder formatter. |
| `i18n.dehydrate()` / `i18n.hydrate(snapshot)` | Serializes and restores locale state for SSR. |
| `i18n.dispose(): void` | Disposes internal signals. |
| `i18nPlugin(options?): VobsPlugin` | Provides the context through `I18N_KEY`. |
| `useI18n(): I18nContext` | Injects the i18n context inside components. |
| `I18nBoundary(props?: I18nBoundaryProps): VobsNode` | Scopes children to a local locale while inheriting the parent catalogs. |

Key lookup walks a fallback chain: the current locale, its language-only part (`zh` from `zh-CN`), then `fallbackLocale` and its language part. Built-in placeholder formatters are `date`, `number`, `currency`, and `relativeTime`.

## Types

`Locale`, `Messages`, `MessageValue`, `LocaleMessages`, `I18nOptions`, `I18nContext`, `I18nPluginOptions`, `I18nBoundaryProps`, `I18nLocaleLoader`, `I18nFormatter`, `I18nDehydratedState`, `DatePreset`, `NumberPreset`
