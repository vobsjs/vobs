import { describe, expect, it } from 'vitest'
import {
  bindText,
  createComponent,
  createDOMRenderer,
  createText,
  createVobs,
  setRenderer,
  type VobsNode
} from '@vobs/vobs'
import { I18nBoundary, createI18n, i18nPlugin, useI18n, type I18nContext } from './index'

setRenderer(createDOMRenderer())

/**
 * `I18nBoundary` used to be a **dead snapshot** (§12.2 #4): the parent context's messages/locale
 * were copied at the moment the boundary was created, so later parent `setMessages`/`loadLocale`
 * calls were never seen inside the boundary; custom formatters and localeLoaders were **not
 * inherited at all** — the former silently degraded placeholders like `{name, shout}` to
 * `String(value)`.
 */
const Inner = (props: { keyName: string; name?: string }): VobsNode => {
  const i18n = useI18n()
  const text = createText('')
  bindText(text, () => i18n.t(props.keyName, props.name === undefined ? undefined : { name: props.name }))
  return text
}

function mountBoundary(i18n: I18nContext, locale: string, innerProps: { keyName: string; name?: string }) {
  const container = document.createElement('main')
  let seen: I18nContext | undefined
  const Probe = (): VobsNode => { seen = useI18n(); return createComponent(Inner, innerProps) }
  const app = createVobs({
    render: () => createComponent(I18nBoundary, {
      locale,
      children: () => createComponent(Probe, {})
    }),
    plugins: [i18nPlugin({ i18n })]
  })
  app.mount(container)
  return { container, app, inner: () => seen! }
}

describe('@vobs/i18n I18nBoundary', () => {
  it('inherits custom formatters from the parent context (no longer silently degraded to String(value))', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { hello: 'Hello {name, shout}' } } })
    i18n.registerFormatter('shout', value => String(value).toUpperCase())

    const view = mountBoundary(i18n, 'en-US', { keyName: 'hello', name: 'ada' })
    expect(view.container.textContent).toBe('Hello ADA')
    view.app.destroy()
    i18n.dispose()
  })

  it('translations added to the parent context later are visible inside the boundary (no longer a dead snapshot)', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { before: 'BEFORE' } } })
    const view = mountBoundary(i18n, 'en-US', { keyName: 'after' })
    expect(view.container.textContent).toBe('after')      // Missing keys return the key itself

    i18n.setMessages('en-US', { after: 'AFTER' })
    view.app.update()
    expect(view.container.textContent).toBe('AFTER')

    view.app.destroy()
    i18n.dispose()
  })

  it('inherits localeLoaders from the parent context', async () => {
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { hi: 'Hi' } },
      localeLoaders: { 'de-DE': async () => ({ hi: 'Hallo' }) }
    })
    const view = mountBoundary(i18n, 'de-DE', { keyName: 'hi' })
    await expect(view.inner().loadLocale('de-DE')).resolves.toBeUndefined()
    await view.inner().loadLocale('de-DE')
    view.app.update()
    expect(view.container.textContent).toBe('Hallo')

    view.app.destroy()
    i18n.dispose()
  })
})
