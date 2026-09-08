import { createI18n, i18nPlugin } from '@vobs/i18n'
import enUS from './locales/en-US.json'

export const i18n = createI18n({
  defaultLocale: 'en-US',
  messages: { 'en-US': enUS },
  localeLoaders: {
    'zh-CN': async () => (await import('./locales/zh-CN.json')).default
  }
})

export const i18nPluginInstance = i18nPlugin({ i18n })
